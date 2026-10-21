import { describe, expect, it } from 'vitest';
import { FRAME_MS, FramePacer, type Clock } from '../../src/music/pacer.js';
import { TrackQueue, type NewTrack } from '../../src/music/queue.js';
import { FRAME_BYTES } from '../../src/music/source.js';
import { readControl } from '../../src/music/socket.js';

const track = (title: string): NewTrack => ({ requestedBy: 'Ana', title, artist: null, durationSeconds: 60, source: title });

describe('fila do painel', () => {
  it('dá um id diferente a cada música e tira uma específica sem mexer nas outras', () => {
    const queue = new TrackQueue(10);
    const [a, b, c] = queue.add([track('a'), track('b'), track('c')]);
    expect(new Set([a.id, b.id, c.id]).size).toBe(3);
    expect(queue.remove(b.id)).toBe(true);
    expect(queue.upcoming().map((t) => t.title)).toEqual(['a', 'c']);
    expect(queue.remove(b.id)).toBe(false);
    expect(queue.remove('nao-existe')).toBe(false);
  });

  it('só tira da espera: a que está tocando não sai pelo id', () => {
    const queue = new TrackQueue(10);
    const [a] = queue.add([track('a'), track('b')]);
    queue.advance();
    expect(queue.current?.id).toBe(a.id);
    expect(queue.remove(a.id)).toBe(false);
  });
});

describe('controles vindos do painel', () => {
  it('aceita as ações simples, remover com id e volume numérico', () => {
    for (const action of ['skip', 'pause', 'resume', 'stop', 'clear']) expect(readControl({ action })).toEqual({ action });
    expect(readControl({ action: 'remove', id: 'abc' })).toEqual({ action: 'remove', id: 'abc' });
    expect(readControl({ action: 'volume', volume: 80 })).toEqual({ action: 'volume', volume: 80 });
  });

  it('recusa formato inválido, ações desconhecidas e campos de outro tipo', () => {
    for (const bad of [null, undefined, 'skip', 42, {}, { action: 7 }, { action: 'explodir' }, { action: 'remove' }, { action: 'remove', id: '' }, { action: 'remove', id: 5 }, { action: 'volume' }, { action: 'volume', volume: '80' }, { action: 'volume', volume: Number.NaN }, { action: 'remove', id: 'x'.repeat(200) }]) {
      expect(readControl(bad)).toBeNull();
    }
  });

  it('ignora campos extras em ações simples (nada de passar lixo adiante)', () => {
    expect(readControl({ action: 'skip', id: 'x', volume: 3, extra: true })).toEqual({ action: 'skip' });
  });
});

describe('posição da música', () => {
  function fakeClock() {
    let now = 0;
    let pending: { at: number; fn: () => void } | null = null;
    const clock: Clock = {
      now: () => now,
      setTimeout: (fn, ms) => (pending = { at: now + ms, fn }),
      clearTimeout: () => (pending = null),
    };
    return {
      clock,
      advance(ms: number) {
        const end = now + ms;
        while (pending && pending.at <= end) {
          const { at, fn } = pending;
          pending = null;
          now = at;
          fn();
        }
        now = end;
      },
    };
  }

  it('conta só o áudio entregue, para na pausa e volta a zero ao trocar de música', () => {
    const time = fakeClock();
    const pacer = new FramePacer(() => {}, () => {}, time.clock);
    pacer.push(Buffer.alloc(50 * FRAME_BYTES));
    pacer.start();
    time.advance(FRAME_MS * 20);
    expect(pacer.playedMs).toBe(200);
    pacer.pause();
    time.advance(FRAME_MS * 100);
    expect(pacer.playedMs).toBe(200);
    pacer.start();
    time.advance(FRAME_MS * 10);
    expect(pacer.playedMs).toBe(300);
    pacer.stop();
    expect(pacer.playedMs).toBe(0);
  });

  it('não conta silêncio (sem áudio na fila o tempo não anda)', () => {
    const time = fakeClock();
    const pacer = new FramePacer(() => {}, () => {}, time.clock);
    pacer.start();
    time.advance(FRAME_MS * 30);
    expect(pacer.playedMs).toBe(0);
  });
});

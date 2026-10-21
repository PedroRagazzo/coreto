import { describe, expect, it } from 'vitest';
import { FRAME_MS, FramePacer, type Clock } from '../../src/music/pacer.js';
import { FRAME_BYTES } from '../../src/music/source.js';

/** Relógio de mentira: o teste decide quando o tempo passa. */
function fakeClock() {
  let now = 0;
  let pending: { at: number; fn: () => void } | null = null;
  const clock: Clock = {
    now: () => now,
    setTimeout: (fn, ms) => {
      pending = { at: now + ms, fn };
      return pending;
    },
    clearTimeout: () => {
      pending = null;
    },
  };
  return {
    clock,
    /** Faz o tempo andar `ms`, disparando o que vencer no caminho. */
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

/** `count` quadros de uma onda constante `value`, em pedaços de tamanho torto para exercitar a emenda. */
function pcm(count: number, value: number): Buffer {
  const buffer = Buffer.alloc(count * FRAME_BYTES);
  for (let i = 0; i < buffer.length / 2; i++) buffer.writeInt16LE(value, i * 2);
  return buffer;
}

describe('FramePacer', () => {
  it('entrega um quadro de 10 ms a cada 10 ms, nem mais rápido nem mais devagar', () => {
    const time = fakeClock();
    const frames: Int16Array[] = [];
    const pacer = new FramePacer((f) => frames.push(f), () => {}, time.clock);
    pacer.push(pcm(50, 100));
    pacer.start();
    time.advance(FRAME_MS * 20);
    expect(frames).toHaveLength(20);
    expect(frames[0]).toHaveLength(FRAME_BYTES / 2);
    expect(pacer.bufferedMs).toBeCloseTo(30 * FRAME_MS, 5);
  });

  it('junta pedaços de tamanhos quebrados em quadros inteiros', () => {
    const time = fakeClock();
    const frames: Int16Array[] = [];
    const pacer = new FramePacer((f) => frames.push(f), () => {}, time.clock);
    const all = pcm(4, 7);
    pacer.push(all.subarray(0, 1001));
    pacer.push(all.subarray(1001, 2500));
    pacer.push(all.subarray(2500));
    pacer.start();
    time.advance(FRAME_MS * 10);
    expect(frames).toHaveLength(4);
    expect(frames.every((f) => f.every((v) => v === 7))).toBe(true);
  });

  it('avisa quando o áudio acaba, só depois de tocar tudo', () => {
    const time = fakeClock();
    let ended = 0;
    const frames: Int16Array[] = [];
    const pacer = new FramePacer((f) => frames.push(f), () => ended++, time.clock);
    pacer.push(pcm(3, 1));
    pacer.end();
    pacer.start();
    time.advance(FRAME_MS * 2);
    expect(ended).toBe(0);
    time.advance(FRAME_MS * 5);
    expect(frames).toHaveLength(3);
    expect(ended).toBe(1);
    time.advance(FRAME_MS * 20);
    expect(ended).toBe(1);
  });

  it('pausa e continua sem perder nem repetir áudio', () => {
    const time = fakeClock();
    const frames: Int16Array[] = [];
    const pacer = new FramePacer((f) => frames.push(f), () => {}, time.clock);
    pacer.push(pcm(10, 5));
    pacer.start();
    time.advance(FRAME_MS * 3);
    pacer.pause();
    time.advance(FRAME_MS * 100);
    expect(frames).toHaveLength(3);
    pacer.start();
    time.advance(FRAME_MS * 4);
    expect(frames).toHaveLength(7);
    expect(pacer.bufferedMs).toBeCloseTo(3 * FRAME_MS, 5);
  });

  it('não solta rajada depois de ficar sem áudio: o tempo perdido é perdido', () => {
    const time = fakeClock();
    const frames: Int16Array[] = [];
    const pacer = new FramePacer((f) => frames.push(f), () => {}, time.clock);
    pacer.start();
    time.advance(FRAME_MS * 50); // 500 ms sem nada para tocar
    expect(frames).toHaveLength(0);
    pacer.push(pcm(100, 9));
    time.advance(FRAME_MS * 10);
    expect(frames.length).toBeLessThanOrEqual(10);
    expect(frames.length).toBeGreaterThanOrEqual(5);
  });

  it('aplica o volume com limite, sem estourar o 16 bits', () => {
    const time = fakeClock();
    const frames: Int16Array[] = [];
    const pacer = new FramePacer((f) => frames.push(f), () => {}, time.clock);
    pacer.gain = 0.5;
    pacer.push(pcm(1, 1000));
    pacer.push(pcm(1, 30000));
    pacer.start();
    time.advance(FRAME_MS * 2);
    expect(frames[0][0]).toBe(500);
    pacer.gain = 2;
    expect(frames[1][0]).toBe(15000);
    pacer.stop();
    pacer.push(pcm(1, 30000));
    pacer.start();
    time.advance(FRAME_MS * 2);
    expect(frames.at(-1)![0]).toBe(32767);
  });
});

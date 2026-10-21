// Entrega o áudio ao WebRTC no ritmo certo: um quadro de 10 ms a cada 10 ms. O ffmpeg decodifica
// bem mais rápido que o tempo real; sem este relógio o áudio chegaria em rajadas e picotaria.

import { FRAME_BYTES } from './source.js';

export const FRAME_MS = 10;
/** Atrasado, o relógio solta alguns quadros de uma vez (no máximo isto) para alcançar o tempo real. */
const MAX_CATCH_UP_FRAMES = 5;

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const realClock: Clock = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

export class FramePacer {
  private chunks: Buffer[] = [];
  private queued = 0;
  private timer: unknown = null;
  private startedAt = 0;
  private sent = 0;
  private running = false;
  private ending = false;
  private played = 0;
  /** Multiplicador do volume; 1 deixa o áudio como veio. */
  gain = 1;

  constructor(
    private readonly sink: (frame: Int16Array) => void,
    private readonly onEnded: () => void,
    private readonly clock: Clock = realClock,
  ) {}

  /** Milissegundos de áudio já entregues desde o último `stop()` (a posição da música). */
  get playedMs(): number {
    return this.played * FRAME_MS;
  }

  /** Milissegundos de áudio esperando para tocar. */
  get bufferedMs(): number {
    return (this.queued / FRAME_BYTES) * FRAME_MS;
  }

  push(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.queued += chunk.length;
  }

  /** Avisa que não vem mais áudio: quando a fila esvaziar, `onEnded` é chamado. */
  end(): void {
    this.ending = true;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.startedAt = this.clock.now();
    this.sent = 0;
    this.schedule();
  }

  /** Para de entregar (a fila fica guardada para continuar depois). */
  pause(): void {
    this.running = false;
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
  }

  stop(): void {
    this.pause();
    this.chunks = [];
    this.queued = 0;
    this.ending = false;
    this.played = 0;
  }

  private schedule(): void {
    const next = this.startedAt + (this.sent + 1) * FRAME_MS;
    this.timer = this.clock.setTimeout(() => this.tick(), Math.max(0, next - this.clock.now()));
  }

  private tick(): void {
    this.timer = null;
    if (!this.running) return;
    const due = Math.floor((this.clock.now() - this.startedAt) / FRAME_MS) - this.sent;
    for (let i = 0; i < Math.min(Math.max(due, 1), MAX_CATCH_UP_FRAMES); i++) {
      const frame = this.take();
      this.sent++;
      if (frame) {
        this.played++;
        this.sink(this.scaled(frame));
      } else if (this.ending) {
        this.running = false;
        this.onEnded();
        return;
      }
    }
    // Atraso grande (o processo ficou parado): recomeça o relógio em vez de soltar tudo de uma vez.
    if (this.clock.now() - (this.startedAt + this.sent * FRAME_MS) > 200) {
      this.startedAt = this.clock.now();
      this.sent = 0;
    }
    this.schedule();
  }

  /** Tira exatamente um quadro da fila, ou `null` se ainda não há o bastante. */
  private take(): Int16Array | null {
    if (this.queued < FRAME_BYTES) return null;
    const frame = Buffer.allocUnsafe(FRAME_BYTES);
    let filled = 0;
    while (filled < FRAME_BYTES) {
      const head = this.chunks[0];
      const size = Math.min(head.length, FRAME_BYTES - filled);
      head.copy(frame, filled, 0, size);
      filled += size;
      if (size === head.length) this.chunks.shift();
      else this.chunks[0] = head.subarray(size);
    }
    this.queued -= FRAME_BYTES;
    // O Buffer pode não estar alinhado em 2 bytes; copia para um Int16Array próprio.
    const samples = new Int16Array(FRAME_BYTES / 2);
    for (let i = 0; i < samples.length; i++) samples[i] = frame.readInt16LE(i * 2);
    return samples;
  }

  private scaled(frame: Int16Array): Int16Array {
    if (this.gain === 1) return frame;
    for (let i = 0; i < frame.length; i++) {
      const v = Math.round(frame[i] * this.gain);
      frame[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
    }
    return frame;
  }
}

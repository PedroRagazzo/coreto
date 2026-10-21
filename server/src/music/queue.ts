// Fila de músicas de uma sala: a que está tocando e as que esperam.

import { randomUUID } from 'node:crypto';

export interface Track {
  /** Identifica a música na fila; é dado quando ela entra. */
  id: string;
  /** Quem pediu, para a mensagem "pedido por ...". */
  requestedBy: string;
  title: string;
  /** Artista ou canal, quando se sabe. */
  artist: string | null;
  /** Em segundos; `null` quando o YouTube não informa. */
  durationSeconds: number | null;
  /** O que o `MusicSource` precisa para abrir o áudio (url do YouTube ou busca). */
  source: string;
}

/** O que uma fonte devolve: a música ainda sem id (a fila dá). */
export type NewTrack = Omit<Track, 'id'>;

export class TrackQueue {
  private waiting: Track[] = [];
  current: Track | null = null;

  constructor(private readonly maxWaiting: number) {}

  get size(): number {
    return this.waiting.length;
  }

  upcoming(): readonly Track[] {
    return this.waiting;
  }

  /**
   * Coloca no fim (ou, com `front`, na frente, para tocar a seguir, mantendo a ordem das que vêm juntas);
   * devolve as que couberam (a fila tem tamanho máximo), já com id.
   */
  add(tracks: NewTrack[], { front = false }: { front?: boolean } = {}): Track[] {
    const room = Math.max(0, this.maxWaiting - this.waiting.length);
    const accepted = tracks.slice(0, room).map((track) => ({ ...track, id: randomUUID() }));
    if (front) this.waiting.unshift(...accepted);
    else this.waiting.push(...accepted);
    return accepted;
  }

  /** Passa uma música que espera para a frente da fila; `false` se ela não está mais na fila. */
  moveToFront(id: string): boolean {
    const at = this.waiting.findIndex((track) => track.id === id);
    if (at < 0) return false;
    this.waiting.unshift(...this.waiting.splice(at, 1));
    return true;
  }

  /** Embaralha as que esperam (a atual não muda); devolve quantas eram. */
  shuffle(random: () => number = Math.random): number {
    for (let i = this.waiting.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [this.waiting[i], this.waiting[j]] = [this.waiting[j], this.waiting[i]];
    }
    return this.waiting.length;
  }

  /** Passa para a próxima; `null` quando acabou. */
  advance(): Track | null {
    this.current = this.waiting.shift() ?? null;
    return this.current;
  }

  /** Tira uma música que ainda espera; `false` se ela não está mais na fila. */
  remove(id: string): boolean {
    const at = this.waiting.findIndex((track) => track.id === id);
    if (at < 0) return false;
    this.waiting.splice(at, 1);
    return true;
  }

  /** Esvazia a fila de espera (a música atual continua). */
  clearWaiting(): number {
    const count = this.waiting.length;
    this.waiting = [];
    return count;
  }

  /** Esvazia tudo, inclusive a atual. */
  reset(): void {
    this.waiting = [];
    this.current = null;
  }
}

/** "3:35" ou "1:02:05"; vazio quando a duração não é conhecida. */
export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '';
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export function describeTrack(track: Pick<Track, 'title' | 'artist' | 'durationSeconds'>): string {
  const duration = formatDuration(track.durationSeconds);
  return `**${track.title}**${track.artist ? ` — ${track.artist}` : ''}${duration ? ` (${duration})` : ''}`;
}

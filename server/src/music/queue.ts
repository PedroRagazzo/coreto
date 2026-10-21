// Fila de músicas de uma sala: a que está tocando e as que esperam.

export interface Track {
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

  /** Coloca no fim; devolve quantas coube (a fila tem tamanho máximo). */
  add(tracks: Track[]): number {
    const room = Math.max(0, this.maxWaiting - this.waiting.length);
    const accepted = tracks.slice(0, room);
    this.waiting.push(...accepted);
    return accepted.length;
  }

  /** Passa para a próxima; `null` quando acabou. */
  advance(): Track | null {
    this.current = this.waiting.shift() ?? null;
    return this.current;
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

export function describeTrack(track: Track): string {
  const duration = formatDuration(track.durationSeconds);
  return `**${track.title}**${track.artist ? ` — ${track.artist}` : ''}${duration ? ` (${duration})` : ''}`;
}

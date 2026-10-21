// De onde vem o áudio do bot de música. A interface existe para os testes trocarem o yt-dlp por um
// gerador de tom; o uso real é o `YtDlpSource` (ytdlp-source.ts).

import type { Readable } from 'node:stream';
import type { MusicRequest } from './links.js';
import type { Track } from './queue.js';

/** Erro com mensagem pronta para mostrar no chat. */
export class MusicError extends Error {}

/** Áudio aberto: PCM de 16 bits, mono, 48 kHz (o que o WebRTC pede), mais quem para tudo. */
export interface AudioHandle {
  pcm: Readable;
  /** Interrompe o download e a conversão. */
  stop(): void;
  /** Quando o áudio acaba: quantos bytes saíram e, se algo deu errado, o motivo. */
  finished: Promise<{ bytes: number; error: string | null }>;
}

export interface MusicSource {
  /** Transforma o pedido em músicas; lança `MusicError` com o motivo se não der. */
  resolve(request: MusicRequest, requestedBy: string, limit: number): Promise<Track[]>;
  open(track: Track): AudioHandle;
}

export const SAMPLE_RATE = 48000;
/** Bytes de 10 ms de áudio mono de 16 bits: o tamanho do quadro que o WebRTC consome. */
export const FRAME_BYTES = (SAMPLE_RATE / 100) * 2;

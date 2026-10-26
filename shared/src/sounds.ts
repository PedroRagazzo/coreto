// Quadro de som: sons curtos que a chamada toda ouve. Os limites e a conferência do arquivo, no servidor e no site.

export const MAX_SOUND_BYTES = 1024 * 1024;
/** Duração máxima de um som, em segundos (o site confere ao decodificar; o servidor só limita o tamanho). */
export const MAX_SOUND_SECONDS = 8;
export const MAX_SOUNDS_PER_SPACE = 24;
export const MAX_SOUND_NAME = 24;

export type AudioKind = 'audio/mpeg' | 'audio/ogg' | 'audio/wav' | 'audio/webm' | 'audio/mp4';

/** Reconhece o formato de áudio pelo conteúdo (não pela extensão nem pelo tipo declarado); `null` se não for um dos aceitos. */
export function sniffAudio(data: Uint8Array): AudioKind | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...data.subarray(from, to));
  if (data.length < 12) return null;
  if (ascii(0, 3) === 'ID3') return 'audio/mpeg';
  // MP3 sem etiqueta: sincronização de quadro (11 bits 1) com versão e camada válidas.
  if (data[0] === 0xff && (data[1]! & 0xe0) === 0xe0 && (data[1]! & 0x18) !== 0x08 && (data[1]! & 0x06) !== 0x00) return 'audio/mpeg';
  if (ascii(0, 4) === 'OggS') return 'audio/ogg';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return 'audio/wav';
  if (data[0] === 0x1a && data[1] === 0x45 && data[2] === 0xdf && data[3] === 0xa3) return 'audio/webm';
  if (ascii(4, 8) === 'ftyp') return 'audio/mp4';
  return null;
}

/** O nome de um som: numa linha só, sem caracteres de controle e sem espaços sobrando; `null` se ficou vazio. */
export function cleanSoundName(raw: unknown): string | null {
  const name = (typeof raw === 'string' ? raw : '')
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SOUND_NAME)
    .trim();
  return name || null;
}

/** O emoji de um som (um só, do seletor); `null` se não for. Aceita qualquer sequência curta que seja um emoji. */
export function cleanSoundEmoji(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!text || text.length > 16) return null;
  const segments = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)];
  return segments.length === 1 && /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(text) ? text : null;
}

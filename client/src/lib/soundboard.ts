// Quadro de som no site: baixar, conferir e enviar os sons.

import { MAX_SOUND_BYTES } from '@shared/sounds';
import type { SoundUploadResponse } from '@shared/protocol';
import { SERVER_URL } from './socket';

export const SOUNDBOARD_VOLUME_KEY = 'coreto.soundboard.volume';
export const SOUNDBOARD_HEAR_MINE_KEY = 'coreto.soundboard.hearMine';

/** Volume do quadro e se você ouve o que toca: as escolhas feitas no quadro de som, que valem também para os atalhos. */
export function readSoundboardPrefs(): { volume: number; hearMine: boolean } {
  const read = (key: string): unknown => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? undefined : JSON.parse(raw);
    } catch {
      return undefined;
    }
  };
  const volume = read(SOUNDBOARD_VOLUME_KEY);
  const hearMine = read(SOUNDBOARD_HEAR_MINE_KEY);
  return {
    volume: typeof volume === 'number' && Number.isFinite(volume) ? Math.min(1, Math.max(0.1, volume)) : 0.8,
    hearMine: typeof hearMine === 'boolean' ? hearMine : true,
  };
}

/** Baixa o áudio de um som (o servidor responde com `Access-Control-Allow-Origin`, para valer também com o site em outra porta). */
export async function fetchSound(id: string): Promise<ArrayBuffer> {
  const res = await fetch(`${SERVER_URL}/sounds/${id}`);
  if (!res.ok) throw new Error('Não foi possível baixar o som.');
  return res.arrayBuffer();
}

/** Motivo para recusar o arquivo antes de enviar, ou `null` se ele puder ir. Confere o tamanho (não há limite de duração). */
export async function checkSoundFile(file: File): Promise<string | null> {
  if (file.size === 0) return `"${file.name}" está vazio.`;
  if (file.size > MAX_SOUND_BYTES) return `"${file.name}" passa de ${MAX_SOUND_BYTES / 1024 / 1024} MB. Use um arquivo menor.`;
  try {
    // Decodificar mostra se é áudio de verdade, sem tocar nada.
    await new OfflineAudioContext(1, 1, 44100).decodeAudioData(await file.arrayBuffer());
  } catch {
    return `"${file.name}" não é um áudio que o navegador consiga tocar (use MP3, OGG, WAV, WebM ou M4A).`;
  }
  return null;
}

/** Envia um som para POST /sounds. */
export async function uploadSound(
  token: string,
  spaceId: string,
  file: File,
  name: string,
  emoji: string | null,
): Promise<SoundUploadResponse> {
  try {
    const res = await fetch(`${SERVER_URL}/sounds`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'x-space-id': encodeURIComponent(spaceId),
        'x-sound-name': encodeURIComponent(name),
        ...(emoji ? { 'x-sound-emoji': encodeURIComponent(emoji) } : {}),
      },
      body: file,
    });
    return (await res.json()) as SoundUploadResponse;
  } catch {
    return { ok: false, error: 'Não foi possível enviar o som. O servidor está rodando?' };
  }
}

// Quadro de som no site: baixar, conferir e enviar os sons.

import { MAX_SOUND_BYTES, MAX_SOUND_SECONDS } from '@shared/sounds';
import type { SoundUploadResponse } from '@shared/protocol';
import { SERVER_URL } from './socket';

/** Baixa o áudio de um som (o servidor responde com `Access-Control-Allow-Origin`, para valer também com o site em outra porta). */
export async function fetchSound(id: string): Promise<ArrayBuffer> {
  const res = await fetch(`${SERVER_URL}/sounds/${id}`);
  if (!res.ok) throw new Error('Não foi possível baixar o som.');
  return res.arrayBuffer();
}

/** Motivo para recusar o arquivo antes de enviar, ou `null` se ele puder ir. Confere o tamanho e a duração. */
export async function checkSoundFile(file: File): Promise<string | null> {
  if (file.size === 0) return `"${file.name}" está vazio.`;
  if (file.size > MAX_SOUND_BYTES) return `"${file.name}" passa de ${MAX_SOUND_BYTES / 1024} KB. Use um som mais curto.`;
  try {
    // Decodificar mostra se é áudio de verdade e quanto dura, sem tocar nada.
    const audio = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(await file.arrayBuffer());
    if (audio.duration > MAX_SOUND_SECONDS) return `O som dura ${Math.ceil(audio.duration)} s; o máximo é ${MAX_SOUND_SECONDS} s.`;
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

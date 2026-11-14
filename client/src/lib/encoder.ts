// Se este computador codifica H.264 pela placa de vídeo.
//
// O Chromium só usa a placa de vídeo para H.264 nos perfis High (640032), Main (4d001f) e Baseline (42001f); o Constrained
// Baseline (42e01f) cai no processador mesmo com placa (ver shared/src/h264.ts). Por isso a pergunta é feita sobre os perfis
// que o Coreto realmente pede, e não sobre o 42e01f.

const GPU_PROFILES = ['640032', '4d001f', '42001f'] as const;

/**
 * `true` se o navegador diz que a placa de vídeo codifica H.264 nesse tamanho e nesses quadros por segundo; `false` se ele
 * sabe codificar mas só pelo processador (ou não suporta); `null` se ele não sabe responder.
 */
export async function probeHardwareH264(width: number, height: number, framerate: number): Promise<boolean | null> {
  const mediaCapabilities = typeof navigator === 'undefined' ? undefined : navigator.mediaCapabilities;
  if (!mediaCapabilities?.encodingInfo) return null;
  let answered = false;
  for (const profile of GPU_PROFILES) {
    try {
      const info = await mediaCapabilities.encodingInfo({
        type: 'webrtc',
        video: { contentType: `video/H264;profile-level-id=${profile}`, width, height, bitrate: 6_000_000, framerate },
      });
      answered = true;
      if (info.supported && info.powerEfficient) return true;
    } catch {
      // Este perfil o navegador não soube responder; tenta o seguinte.
    }
  }
  return answered ? false : null;
}

/** A largura de uma tela 16:9 com essa altura (1440 → 2560). */
export const widthFor = (height: number): number => Math.round((height * 16) / 9);

// Banda inicial do vídeo no SDP.
//
// O WebRTC começa a estimar a banda em ~300 kbps e sobe aos poucos: a transmissão pela malha P2P leva uns 20 s para chegar
// no tamanho cheio (320 → 640 → 960 → 1280 de largura), e nesse tempo a imagem fica borrada. O parâmetro
// `x-google-start-bitrate` (em kbps) no fmtp do codec de vídeo faz o Chromium (Chrome, Edge e o app de desktop) começar a
// estimativa mais alto. Se a rede não aguenta, a estimativa cai sozinha em poucos segundos; se aguenta, ganha-se a subida.

/** Piso e teto do começo da estimativa, em kbps: abaixo do piso não adianta; acima do teto, uma rede fraca engasgaria. */
export const MIN_START_KBPS = 500;
export const MAX_START_KBPS = 2_500;

/** Fração do bitrate-alvo com que a estimativa começa: o bastante para a imagem sair nítida, com folga para a rede dizer "não". */
const START_SHARE = 0.6;

/** O começo da estimativa, em kbps, para uma transmissão cujo teto é `targetBitrate` (bits por segundo). */
export function startBitrateKbps(targetBitrate: number): number {
  const kbps = Math.round((targetBitrate * START_SHARE) / 1000);
  return Math.max(MIN_START_KBPS, Math.min(MAX_START_KBPS, kbps));
}

const VIDEO_CODEC = /^a=rtpmap:(\d+) (VP8|VP9|H264|AV1X?|H265)\/90000\s*$/i;

/**
 * Devolve o SDP com `x-google-start-bitrate` no fmtp de cada codec de vídeo de verdade (VP8, VP9, H.264, AV1; não o RTX,
 * o RED nem o ULPFEC); o resto fica como está. Vale duas vezes sem mudar nada.
 */
export function withVideoStartBitrate(sdp: string, kbps: number): string {
  const value = String(Math.round(kbps));
  const eol = sdp.includes('\r\n') ? '\r\n' : '\n';
  const lines = sdp.split(eol);

  const payloads = lines.flatMap((line) => {
    const match = VIDEO_CODEC.exec(line);
    return match ? [match[1]] : [];
  });
  // De trás para a frente, para que acrescentar uma linha não mude a posição das que faltam.
  for (const payload of payloads.reverse()) {
    const prefix = `a=fmtp:${payload} `;
    const fmtp = lines.findIndex((line) => line.startsWith(prefix));
    if (fmtp >= 0) {
      const params = lines[fmtp]
        .slice(prefix.length)
        .split(';')
        .map((part) => part.trim())
        .filter((part) => part && !part.toLowerCase().startsWith('x-google-start-bitrate='));
      lines[fmtp] = `${prefix}${[...params, `x-google-start-bitrate=${value}`].join(';')}`;
    } else {
      const rtpmap = lines.findIndex((line) => line.startsWith(`a=rtpmap:${payload} `));
      lines.splice(rtpmap + 1, 0, `${prefix}x-google-start-bitrate=${value}`);
    }
  }
  return lines.join(eol);
}

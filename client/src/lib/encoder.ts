// Se este computador codifica H.264 pela placa de vídeo, num tamanho e numa taxa de quadros.
//
// A pergunta certa é a do WebCodecs: `VideoEncoder.isConfigSupported` com `hardwareAcceleration: 'prefer-hardware'` só diz
// "sim" quando existe um codificador de placa de vídeo para aquela configuração. Medido no Electron 44 com uma RTX: "sim"
// até 1080p a 60 fps e em 2K a 30 fps, e "não" em 2K a 60 fps (aí o navegador cai para o processador), e "não" com a
// codificação por placa desligada. `mediaCapabilities.encodingInfo` (`powerEfficient`) não serve: dá "não" para tudo,
// mesmo com a placa codificando. E as estatísticas do WebRTC (`encoderImplementation`) só aparecem com uma captura ativa.

/** High e Main no nível 5.2 (qualquer tamanho que a placa aceite) e no 4.2, caso o navegador estranhe o nível alto. */
const CODECS = ['avc1.640034', 'avc1.4d4034', 'avc1.64002a', 'avc1.4d402a'] as const;

/**
 * `true` se a placa de vídeo codifica H.264 nesse tamanho e nesses quadros por segundo; `false` se não (o navegador usaria o
 * processador, ou nem suporta); `null` se o navegador não sabe responder (sem WebCodecs).
 */
export async function probeHardwareH264(width: number, height: number, framerate: number): Promise<boolean | null> {
  if (typeof VideoEncoder === 'undefined' || !VideoEncoder.isConfigSupported) return null;
  let answered = false;
  for (const codec of CODECS) {
    try {
      const result = await VideoEncoder.isConfigSupported({
        codec,
        width,
        height,
        framerate,
        bitrate: 8_000_000,
        hardwareAcceleration: 'prefer-hardware',
        latencyMode: 'realtime',
      });
      answered = true;
      if (result.supported) return true;
    } catch {
      // Este formato o navegador não soube avaliar; tenta o seguinte.
    }
  }
  return answered ? false : null;
}

/** A largura de uma tela 16:9 com essa altura (1440 → 2560). */
export const widthFor = (height: number): number => Math.round((height * 16) / 9);

// Quanto de qualidade cabe numa transmissão de tela, dado o upload de quem transmite e
// quantas pessoas assistem. No Coreto cada espectador recebe uma cópia do vídeo (malha
// P2P), então o upload se divide entre eles.

export interface QualityOptions {
  /** Altura máxima em pixels; `null` = resolução original da tela. */
  height: 720 | 1080 | null;
  frameRate: 15 | 30 | 60;
  /** Velocidade de envio (upload) da internet de quem transmite, em Mbps. */
  uploadMbps: number;
}

/** 60 quadros pedem mais bits; 15, menos. */
export const fpsFactor = (frameRate: number) => (frameRate === 60 ? 1.5 : frameRate === 15 ? 0.6 : 1);

/** Por onde a imagem vai: pelo servidor de mídia (uma cópia só) ou direto entre os navegadores (uma por espectador). */
export type StreamRoute = 'sfu' | 'p2p';

/**
 * Teto de bits por segundo do vídeo de cada espectador, por altura × quadros. Pelo servidor de mídia o upload não se
 * divide, então o teto é maior: jogo rápido muda a imagem toda a cada quadro e fica cheio de blocos com pouco bitrate.
 */
export function maxBitrate({ height, frameRate }: Pick<QualityOptions, 'height' | 'frameRate'>, via: StreamRoute = 'p2p'): number {
  const base =
    via === 'sfu'
      ? height === 720 ? 3_500_000 : height === 1080 ? 6_500_000 : 9_000_000
      : height === 720 ? 2_500_000 : height === 1080 ? 4_500_000 : 6_000_000;
  return fpsFactor(frameRate) * base;
}

/** Fração do upload usada pela transmissão: o resto fica para voz, câmera e o resto da casa. */
export const UPLOAD_SHARE = 0.7;
export const MIN_VIEWER_BITRATE = 400_000;

/**
 * Bitrate de cada espectador: o teto da qualidade escolhida, ou a parte dele no upload disponível,
 * o que for menor. Sem esta divisão, três ou quatro cópias brigam pela mesma internet e todas
 * ficam ruins.
 */
export function viewerBitrate(options: QualityOptions, viewers: number, via: StreamRoute = 'p2p'): number {
  const share = (options.uploadMbps * 1_000_000 * UPLOAD_SHARE) / Math.max(1, viewers);
  return Math.round(Math.max(MIN_VIEWER_BITRATE, Math.min(maxBitrate(options, via), share)));
}

/** Quanto de bitrate cada altura pede para ficar nítida a 30 quadros por segundo (texto e telas). */
export const HEIGHT_LADDER = [
  { height: 1440, bitrate: 6_000_000 },
  { height: 1080, bitrate: 3_500_000 },
  { height: 900, bitrate: 2_600_000 },
  { height: 720, bitrate: 1_800_000 },
  { height: 540, bitrate: 1_000_000 },
  { height: 360, bitrate: 600_000 },
] as const;

/** Imagem em movimento (jogo, vídeo) pede mais bits por pixel que tela parada: a escada acima vale para texto. */
export const MOTION_FACTOR = 1.4;

/**
 * Quanto reduzir a imagem para ela caber no bitrate disponível. Com pouco bitrate, uma imagem
 * menor e nítida é melhor que uma grande e cheia de blocos. 1 = sem redução. Na prioridade `smooth`
 * (jogos e vídeos) cada altura pede mais bitrate, então a imagem encolhe antes de virar blocos.
 */
export function resolutionScale(sourceHeight: number, bitrate: number, frameRate: number, priority: 'sharp' | 'smooth' = 'sharp'): number {
  if (!sourceHeight) return 1;
  const need = fpsFactor(frameRate) * (priority === 'smooth' ? MOTION_FACTOR : 1);
  const fits = HEIGHT_LADDER.find((step) => step.bitrate * need <= bitrate) ?? HEIGHT_LADDER[HEIGHT_LADDER.length - 1];
  return Math.max(1, sourceHeight / Math.min(fits.height, sourceHeight));
}

// ── Diagnóstico em palavras ──────────────────────────────────────────────────

/** Os números de uma transmissão que o diagnóstico lê (as estatísticas do painel, mais o teto e a estimativa da rede). */
export interface StreamDiagnosisInput {
  role: 'sending' | 'receiving';
  via: StreamRoute;
  /** Só ao transmitir: o que o navegador diz que limita a qualidade. */
  limit: 'none' | 'bandwidth' | 'cpu' | 'other' | null;
  /** Só ao transmitir: quem codifica o vídeo. */
  encoder: 'hardware' | 'software' | null;
  lossPercent: number;
  rttMs: number | null;
  /** Só ao transmitir: o teto de bitrate pedido ao codificador, para cada espectador (kbps). */
  capKbps: number | null;
  /** Só ao transmitir: quanto a rede estima que comporta até o servidor (ou até o espectador), em kbps. */
  availableKbps: number | null;
  /** Só ao assistir: quantas vezes a imagem congelou nos últimos 30 segundos. */
  freezes: number;
}

export type StreamAdvice =
  | 'cpu-software'
  | 'cpu'
  | 'bandwidth-sfu'
  | 'bandwidth-p2p'
  | 'path-limit'
  | 'loss-far'
  | 'loss'
  | 'freezes-loss'
  | 'freezes-source';

/** Perda de pacotes a partir da qual vale avisar. */
export const LOSS_ALERT_PERCENT = 3;
/** Ida e volta (ms) a partir da qual uma retransmissão já aparece como travada. */
export const FAR_RTT_MS = 150;
/** A rede comporta menos que esta fração do teto pedido: o caminho é o gargalo, não o computador. */
export const PATH_LIMIT_RATIO = 0.75;
/** Travadas em 30 s a partir das quais vale avisar (uma só passa despercebida). */
export const FREEZE_ALERT = 2;

/** A principal causa de uma imagem ruim, a partir dos números; `null` se está tudo bem. */
export function diagnoseStream(input: StreamDiagnosisInput): StreamAdvice | null {
  if (input.role === 'sending') {
    if (input.limit === 'cpu') return input.encoder === 'software' && input.via === 'sfu' ? 'cpu-software' : 'cpu';
    if (input.limit === 'bandwidth') return input.via === 'sfu' ? 'bandwidth-sfu' : 'bandwidth-p2p';
    if (input.availableKbps !== null && input.capKbps !== null && input.availableKbps < input.capKbps * PATH_LIMIT_RATIO) return 'path-limit';
    if (input.lossPercent > LOSS_ALERT_PERCENT) return input.rttMs !== null && input.rttMs > FAR_RTT_MS ? 'loss-far' : 'loss';
    return null;
  }
  if (input.freezes >= FREEZE_ALERT) return input.lossPercent > 1 ? 'freezes-loss' : 'freezes-source';
  if (input.lossPercent > LOSS_ALERT_PERCENT) return 'loss';
  return null;
}

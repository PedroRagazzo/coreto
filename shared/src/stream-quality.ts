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

/** Teto de bits por segundo do vídeo de cada espectador, por altura × quadros. */
export function maxBitrate({ height, frameRate }: Pick<QualityOptions, 'height' | 'frameRate'>): number {
  const base = height === 720 ? 2_500_000 : height === 1080 ? 4_500_000 : 6_000_000;
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
export function viewerBitrate(options: QualityOptions, viewers: number): number {
  const share = (options.uploadMbps * 1_000_000 * UPLOAD_SHARE) / Math.max(1, viewers);
  return Math.round(Math.max(MIN_VIEWER_BITRATE, Math.min(maxBitrate(options), share)));
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

/**
 * Quanto reduzir a imagem para ela caber no bitrate disponível. Com pouco bitrate, uma imagem
 * menor e nítida é melhor que uma grande e cheia de blocos. 1 = sem redução.
 */
export function resolutionScale(sourceHeight: number, bitrate: number, frameRate: number): number {
  if (!sourceHeight) return 1;
  const fits = HEIGHT_LADDER.find((step) => step.bitrate * fpsFactor(frameRate) <= bitrate) ?? HEIGHT_LADDER[HEIGHT_LADDER.length - 1];
  return Math.max(1, sourceHeight / Math.min(fits.height, sourceHeight));
}

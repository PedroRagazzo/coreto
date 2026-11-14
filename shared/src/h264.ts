// Qual perfil de H.264 oferecer primeiro para a placa de vídeo codificar a transmissão.
//
// O Chromium (Chrome, Edge e o app de desktop) só usa a placa de vídeo para H.264 nos perfis Baseline (42001f), Main
// (4d001f) e High (640032). No "Constrained Baseline" (42e01f), que é o que o servidor de mídia negocia quando ninguém
// escolhe, ele cai no OpenH264, que roda no processador. Medido com o LiveKit local numa RTX com o Electron 44: 42e01f
// saía em 640x360 pelo processador, e o perfil High saía em 1920x1080 pela placa. High também comprime melhor que
// Baseline com o mesmo bitrate.

/** O que o navegador informa de cada codec em `RTCRtpSender.getCapabilities('video')`. */
export interface VideoCodecCapability {
  mimeType: string;
  sdpFmtpLine?: string;
}

/** Quanto menor, antes: High, Main, Baseline, e o Constrained Baseline (só processador) por último, como reserva. */
function h264Rank(sdpFmtpLine: string | undefined): number {
  const profile = /profile-level-id=([0-9a-f]{6})/i.exec(sdpFmtpLine ?? '')?.[1]?.toLowerCase();
  if (!profile) return 4;
  if (profile.startsWith('64')) return 0;
  if (profile.startsWith('4d')) return 1;
  if (profile.startsWith('42')) return profile.startsWith('42e0') ? 3 : 2;
  return 4;
}

const isH264 = (codec: VideoCodecCapability) => codec.mimeType.toLowerCase() === 'video/h264';

/**
 * Os codecs na ordem para `setCodecPreferences`: os H.264 que a placa de vídeo sabe codificar primeiro (mantendo a ordem
 * do navegador entre perfis iguais), depois o resto sem mudar. `null` se não há H.264 ou se os perfis já estão nessa ordem
 * (não há o que melhorar).
 */
export function preferHardwareH264<T extends VideoCodecCapability>(codecs: readonly T[]): T[] | null {
  const h264 = codecs.filter(isH264);
  if (h264.length === 0) return null;
  const sorted = h264
    .map((codec, index) => ({ codec, index }))
    .sort((a, b) => h264Rank(a.codec.sdpFmtpLine) - h264Rank(b.codec.sdpFmtpLine) || a.index - b.index)
    .map(({ codec }) => codec);
  if (sorted.every((codec, index) => codec === h264[index])) return null;
  return [...sorted, ...codecs.filter((codec) => !isH264(codec))];
}

/**
 * Os codecs na ordem de preferência para a escolha da pessoa: `h264` (placa de vídeo) põe os perfis que a placa codifica
 * na frente, de todos os outros codecs, mesmo que já estivessem na ordem certa entre si; `vp8` (processador) põe o VP8 na
 * frente. `null` se não há o que mudar (codec ausente ou a lista já está assim). Serve à malha P2P, onde o navegador
 * escolhe o codec sozinho; no servidor de mídia o codec é pedido na publicação.
 */
export function codecOrderFor<T extends VideoCodecCapability>(codecs: readonly T[], choice: 'h264' | 'vp8'): T[] | null {
  let ordered: T[];
  if (choice === 'h264') {
    const h264 = preferHardwareH264(codecs) ?? codecs.filter(isH264);
    if (h264.length === 0 || !codecs.some(isH264)) return null;
    // `preferHardwareH264` já devolve a lista inteira reordenada; sem ela, os H.264 vão na frente e o resto segue.
    ordered = h264.length === codecs.length ? h264 : [...h264, ...codecs.filter((c) => !isH264(c))];
  } else {
    const vp8 = codecs.filter((c) => c.mimeType.toLowerCase() === 'video/vp8');
    if (vp8.length === 0) return null;
    ordered = [...vp8, ...codecs.filter((c) => !vp8.includes(c))];
  }
  return ordered.every((codec, index) => codec === codecs[index]) ? null : ordered;
}

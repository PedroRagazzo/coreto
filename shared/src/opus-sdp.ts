// Ajuste do SDP para receber música em estéreo e com mais qualidade.
//
// O Opus do WebRTC só usa estéreo se quem recebe pedir: o parâmetro `stereo=1` no SDP de quem recebe. Sem ele, o
// navegador decodifica tudo como mono, mesmo que o outro lado envie estéreo. Já `maxaveragebitrate` diz ao
// emissor quanto ele pode usar (o padrão do WebRTC, 32 kbps por canal, é pouco para música).

/** Bitrate médio máximo pedido ao bot de música: 128 kbps em estéreo é qualidade de música. */
export const MUSIC_MAX_AVERAGE_BITRATE = 128_000;

/** Devolve o SDP pedindo estéreo no Opus (e o bitrate máximo); o resto fica como está. */
export function withStereoOpus(sdp: string, maxAverageBitrate: number = MUSIC_MAX_AVERAGE_BITRATE): string {
  const eol = sdp.includes('\r\n') ? '\r\n' : '\n';
  const lines = sdp.split(eol);
  const wanted = { stereo: '1', maxaveragebitrate: String(Math.round(maxAverageBitrate)) };

  const payloads = lines.flatMap((line) => {
    const match = /^a=rtpmap:(\d+) opus\/48000\/2\s*$/i.exec(line);
    return match ? [match[1]] : [];
  });
  for (const payload of payloads) {
    const fmtp = lines.findIndex((line) => line.startsWith(`a=fmtp:${payload} `));
    if (fmtp >= 0) {
      const params = new Map(
        lines[fmtp]
          .slice(`a=fmtp:${payload} `.length)
          .split(';')
          .map((part) => part.trim())
          .filter(Boolean)
          .map((part): [string, string] => {
            const at = part.indexOf('=');
            return at < 0 ? [part, ''] : [part.slice(0, at), part.slice(at + 1)];
          }),
      );
      for (const [key, value] of Object.entries(wanted)) params.set(key, value);
      lines[fmtp] = `a=fmtp:${payload} ${[...params].map(([key, value]) => (value ? `${key}=${value}` : key)).join(';')}`;
    } else {
      const rtpmap = lines.findIndex((line) => line.startsWith(`a=rtpmap:${payload} `));
      lines.splice(rtpmap + 1, 0, `a=fmtp:${payload} ${Object.entries(wanted).map(([key, value]) => `${key}=${value}`).join(';')}`);
    }
  }
  return lines.join(eol);
}

import { describe, expect, it } from 'vitest';
import { withStereoOpus, withVoiceOpus } from '../../../shared/src/opus-sdp.js';

const audio = (fmtp: string | null) =>
  [
    'v=0',
    'm=audio 9 UDP/TLS/RTP/SAVPF 111 63 9',
    'a=rtpmap:111 opus/48000/2',
    ...(fmtp ? [`a=fmtp:111 ${fmtp}`] : []),
    'a=rtpmap:63 red/48000/2',
    'a=rtpmap:9 G722/8000',
    'a=mid:0',
    '',
  ].join('\r\n');

describe('withStereoOpus', () => {
  it('pede estéreo e o bitrate no fmtp do Opus que já existe, mantendo o resto', () => {
    const out = withStereoOpus(audio('minptime=10;useinbandfec=1'), 128_000);
    expect(out).toContain('a=fmtp:111 minptime=10;useinbandfec=1;stereo=1;maxaveragebitrate=128000\r\n');
    expect(out).toContain('a=rtpmap:63 red/48000/2');
    expect(out.split('\r\n')).toHaveLength(audio('minptime=10;useinbandfec=1').split('\r\n').length);
  });

  it('troca valores que já estavam lá em vez de repetir o parâmetro', () => {
    const out = withStereoOpus(audio('stereo=0;maxaveragebitrate=32000;useinbandfec=1'), 96_000);
    expect(out).toContain('a=fmtp:111 stereo=1;maxaveragebitrate=96000;useinbandfec=1\r\n');
  });

  it('cria o fmtp logo depois do rtpmap quando o Opus não tinha nenhum', () => {
    const lines = withStereoOpus(audio(null)).split('\r\n');
    const at = lines.indexOf('a=rtpmap:111 opus/48000/2');
    expect(lines[at + 1]).toBe('a=fmtp:111 stereo=1;maxaveragebitrate=128000');
  });

  it('vale duas vezes sem mudar nada, e respeita o fim de linha do SDP', () => {
    const once = withStereoOpus(audio('useinbandfec=1'));
    expect(withStereoOpus(once)).toBe(once);
    const lf = audio('useinbandfec=1').replace(/\r\n/g, '\n');
    expect(withStereoOpus(lf)).not.toContain('\r');
  });

  it('não mexe em SDP sem Opus', () => {
    const sdp = ['v=0', 'm=video 9 UDP/TLS/RTP/SAVPF 96', 'a=rtpmap:96 VP8/90000', ''].join('\r\n');
    expect(withStereoOpus(sdp)).toBe(sdp);
  });
});

describe('withVoiceOpus', () => {
  it('pede 64 kbps, FEC ligado e sem DTX, em mono (sem stereo=1), mantendo o resto', () => {
    const out = withVoiceOpus(audio('minptime=10;useinbandfec=1'));
    expect(out).toContain('a=fmtp:111 minptime=10;useinbandfec=1;maxaveragebitrate=64000;usedtx=0\r\n');
    expect(out).not.toContain('stereo');
    expect(out).toContain('a=rtpmap:63 red/48000/2');
  });

  it('troca o que já estava (o padrão de 32 kbps, DTX ligado) e liga o FEC se faltava', () => {
    const out = withVoiceOpus(audio('maxaveragebitrate=32000;usedtx=1'));
    expect(out).toContain('a=fmtp:111 maxaveragebitrate=64000;usedtx=0;useinbandfec=1\r\n');
  });

  it('aceita outro bitrate, vale duas vezes sem mudar nada e não mexe em SDP sem Opus', () => {
    expect(withVoiceOpus(audio(null), 96_000)).toContain('maxaveragebitrate=96000');
    const once = withVoiceOpus(audio('useinbandfec=1'));
    expect(withVoiceOpus(once)).toBe(once);
    const noOpus = ['v=0', 'm=video 9 UDP/TLS/RTP/SAVPF 96', 'a=rtpmap:96 VP8/90000', ''].join('\r\n');
    expect(withVoiceOpus(noOpus)).toBe(noOpus);
  });
});

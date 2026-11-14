import { describe, expect, it } from 'vitest';
import { MAX_START_KBPS, MIN_START_KBPS, startBitrateKbps, withVideoStartBitrate } from '../../../shared/src/video-sdp.js';

const video = [
  'v=0',
  'm=video 9 UDP/TLS/RTP/SAVPF 96 97 98 99 102 103 104 105',
  'a=rtpmap:96 VP8/90000',
  'a=rtpmap:97 rtx/90000',
  'a=fmtp:97 apt=96',
  'a=rtpmap:98 VP9/90000',
  'a=fmtp:98 profile-id=0',
  'a=rtpmap:99 rtx/90000',
  'a=fmtp:99 apt=98',
  'a=rtpmap:102 H264/90000',
  'a=fmtp:102 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=640032',
  'a=rtpmap:103 rtx/90000',
  'a=fmtp:103 apt=102',
  'a=rtpmap:104 red/90000',
  'a=rtpmap:105 ulpfec/90000',
  'a=mid:1',
  '',
].join('\r\n');

describe('withVideoStartBitrate', () => {
  it('põe a banda inicial em cada codec de vídeo, criando o fmtp quando não havia', () => {
    const out = withVideoStartBitrate(video, 1500).split('\r\n');
    expect(out).toContain('a=fmtp:98 profile-id=0;x-google-start-bitrate=1500');
    expect(out).toContain('a=fmtp:102 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=640032;x-google-start-bitrate=1500');
    // O VP8 não tinha fmtp: ele aparece logo depois do rtpmap.
    expect(out[out.indexOf('a=rtpmap:96 VP8/90000') + 1]).toBe('a=fmtp:96 x-google-start-bitrate=1500');
  });

  it('não mexe no que não é codec de vídeo: RTX, RED e ULPFEC ficam como estavam', () => {
    const out = withVideoStartBitrate(video, 1500);
    for (const line of ['a=fmtp:97 apt=96', 'a=fmtp:99 apt=98', 'a=fmtp:103 apt=102', 'a=rtpmap:104 red/90000', 'a=rtpmap:105 ulpfec/90000', 'a=mid:1']) {
      expect(out.split('\r\n')).toContain(line);
    }
    expect(out).not.toContain('apt=96;x-google');
    expect(out).not.toContain('a=fmtp:104');
  });

  it('troca o valor que já estava lá em vez de repetir o parâmetro, e vale duas vezes sem mudar nada', () => {
    const once = withVideoStartBitrate(video, 1500);
    expect(withVideoStartBitrate(once, 1500)).toBe(once);
    const changed = withVideoStartBitrate(once, 900);
    expect(changed).toContain('a=fmtp:98 profile-id=0;x-google-start-bitrate=900');
    expect(changed).not.toContain('1500');
  });

  it('respeita o fim de linha do SDP e deixa o áudio quieto', () => {
    const lf = video.replace(/\r\n/g, '\n');
    expect(withVideoStartBitrate(lf, 1000)).not.toContain('\r');
    const audio = ['m=audio 9 UDP/TLS/RTP/SAVPF 111', 'a=rtpmap:111 opus/48000/2', 'a=fmtp:111 useinbandfec=1', ''].join('\r\n');
    expect(withVideoStartBitrate(audio, 1000)).toBe(audio);
  });

  it('aceita SDP sem vídeo nenhum', () => {
    expect(withVideoStartBitrate('v=0\r\n', 1000)).toBe('v=0\r\n');
    expect(withVideoStartBitrate('', 1000)).toBe('');
  });
});

describe('startBitrateKbps', () => {
  it('começa em 60% do alvo, dentro de um piso e um teto', () => {
    expect(startBitrateKbps(2_500_000)).toBe(1500);
    expect(startBitrateKbps(400_000)).toBe(MIN_START_KBPS);
    expect(startBitrateKbps(9_000_000)).toBe(MAX_START_KBPS);
  });
});

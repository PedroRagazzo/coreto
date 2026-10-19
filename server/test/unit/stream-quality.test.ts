import { describe, expect, it } from 'vitest';
import { maxBitrate, MIN_VIEWER_BITRATE, resolutionScale, viewerBitrate, type QualityOptions } from '../../../shared/src/stream-quality.js';

const options = (patch: Partial<QualityOptions> = {}): QualityOptions => ({ height: 1080, frameRate: 30, uploadMbps: 10, ...patch });

describe('viewerBitrate', () => {
  it('com poucos espectadores, usa o teto da qualidade escolhida', () => {
    expect(viewerBitrate(options(), 1)).toBe(maxBitrate(options()));
    expect(viewerBitrate(options({ height: 720 }), 1)).toBe(2_500_000);
  });

  it('divide o upload entre os espectadores', () => {
    // 10 Mbps × 70% = 7 Mbps: 1080p30 pede 4,5 Mbps (cabe para 1) e passa a 2,33 Mbps para 3.
    expect(viewerBitrate(options(), 1)).toBe(4_500_000);
    expect(viewerBitrate(options(), 3)).toBe(2_333_333);
    expect(viewerBitrate(options(), 6)).toBe(1_166_667);
  });

  it('um upload maior sustenta mais espectadores', () => {
    expect(viewerBitrate(options({ uploadMbps: 50 }), 3)).toBe(4_500_000);
    expect(viewerBitrate(options({ uploadMbps: 5 }), 3)).toBe(1_166_667);
  });

  it('nunca desce abaixo de um mínimo e trata zero espectadores como um', () => {
    expect(viewerBitrate(options({ uploadMbps: 5 }), 50)).toBe(MIN_VIEWER_BITRATE);
    expect(viewerBitrate(options(), 0)).toBe(viewerBitrate(options(), 1));
  });

  it('60 quadros pedem mais bits e 15 pedem menos', () => {
    expect(maxBitrate(options({ frameRate: 60 }))).toBe(6_750_000);
    expect(maxBitrate(options({ frameRate: 15 }))).toBe(2_700_000);
    expect(maxBitrate(options({ height: null }))).toBe(6_000_000);
  });
});

describe('resolutionScale', () => {
  it('não reduz quando o bitrate dá para a resolução da tela', () => {
    expect(resolutionScale(1080, 4_500_000, 30)).toBe(1);
    expect(resolutionScale(720, 2_500_000, 30)).toBe(1);
  });

  it('reduz a imagem, em vez de deixá-la cheia de blocos, quando o bitrate é pouco', () => {
    // 1080p precisa de 3,5 Mbps a 30 fps; com 2 Mbps a imagem vai para 720p.
    expect(resolutionScale(1080, 2_000_000, 30)).toBeCloseTo(1080 / 720);
    // Com 700 kbps, 360p.
    expect(resolutionScale(1080, 700_000, 30)).toBeCloseTo(3);
  });

  it('60 quadros pedem mais bitrate para a mesma altura', () => {
    // 1080p a 60 fps precisa de 5,25 Mbps: com 4,5 Mbps cai para 900p.
    expect(resolutionScale(1080, 4_500_000, 60)).toBeCloseTo(1080 / 900);
  });

  it('nunca aumenta a imagem e tolera altura desconhecida', () => {
    expect(resolutionScale(480, 6_000_000, 30)).toBe(1);
    expect(resolutionScale(0, 1_000_000, 30)).toBe(1);
  });

  it('com muito pouco bitrate, usa o menor degrau', () => {
    expect(resolutionScale(1080, 100_000, 30)).toBeCloseTo(3);
  });
});

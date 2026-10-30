import { describe, expect, it } from 'vitest';
import {
  diagnoseStream,
  maxBitrate,
  MIN_VIEWER_BITRATE,
  resolutionScale,
  viewerBitrate,
  type QualityOptions,
  type StreamDiagnosisInput,
} from '../../../shared/src/stream-quality.js';

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

describe('teto pelo servidor de mídia', () => {
  it('é maior que na malha P2P, porque sai uma cópia só', () => {
    expect(maxBitrate(options(), 'sfu')).toBe(6_500_000);
    expect(maxBitrate(options({ frameRate: 60 }), 'sfu')).toBe(9_750_000);
    expect(maxBitrate(options({ height: 720 }), 'sfu')).toBe(3_500_000);
    expect(maxBitrate(options({ height: null }), 'sfu')).toBe(9_000_000);
  });

  it('o upload informado ainda manda: 70% dele', () => {
    // 10 Mbps × 70% = 7 Mbps: 1080p60 pede 9,75 Mbps, então fica em 7.
    expect(viewerBitrate(options({ frameRate: 60 }), 1, 'sfu')).toBe(7_000_000);
    expect(viewerBitrate(options({ frameRate: 60, uploadMbps: 20 }), 1, 'sfu')).toBe(9_750_000);
  });

  it('sem dizer o caminho, as contas são as da malha P2P', () => {
    expect(viewerBitrate(options(), 1)).toBe(viewerBitrate(options(), 1, 'p2p'));
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

  it('jogo e vídeo (Fluidez) pedem mais bitrate por altura: a imagem encolhe antes de virar blocos', () => {
    // 1080p a 60 fps com 7 Mbps: texto ainda cabe em 1080p (5,25), movimento (7,35) não e vai para 900p.
    expect(resolutionScale(1080, 7_000_000, 60, 'sharp')).toBe(1);
    expect(resolutionScale(1080, 7_000_000, 60, 'smooth')).toBeCloseTo(1080 / 900);
    // Com bitrate de sobra, nada muda.
    expect(resolutionScale(1080, 10_000_000, 60, 'smooth')).toBe(1);
  });

  it('nunca aumenta a imagem e tolera altura desconhecida', () => {
    expect(resolutionScale(480, 6_000_000, 30)).toBe(1);
    expect(resolutionScale(0, 1_000_000, 30)).toBe(1);
  });

  it('com muito pouco bitrate, usa o menor degrau', () => {
    expect(resolutionScale(1080, 100_000, 30)).toBeCloseTo(3);
  });
});

describe('diagnoseStream', () => {
  const sending = (patch: Partial<StreamDiagnosisInput> = {}): StreamDiagnosisInput => ({
    role: 'sending',
    via: 'sfu',
    limit: 'none',
    encoder: 'hardware',
    lossPercent: 0,
    rttMs: 40,
    capKbps: 6_750,
    availableKbps: 12_000,
    freezes: 0,
    ...patch,
  });
  const receiving = (patch: Partial<StreamDiagnosisInput> = {}): StreamDiagnosisInput => ({
    ...sending({ role: 'receiving', limit: null, encoder: null, capKbps: null, availableKbps: null }),
    ...patch,
  });

  it('está tudo bem quando nada limita', () => {
    expect(diagnoseStream(sending())).toBeNull();
    expect(diagnoseStream(receiving())).toBeNull();
  });

  it('o computador no limite: sugere H.264 se é o processador que codifica pelo servidor de mídia', () => {
    expect(diagnoseStream(sending({ limit: 'cpu', encoder: 'software' }))).toBe('cpu-software');
    expect(diagnoseStream(sending({ limit: 'cpu', encoder: 'hardware' }))).toBe('cpu');
    expect(diagnoseStream(sending({ limit: 'cpu', encoder: 'software', via: 'p2p' }))).toBe('cpu');
  });

  it('a internet no limite, pelo servidor ou direto', () => {
    expect(diagnoseStream(sending({ limit: 'bandwidth' }))).toBe('bandwidth-sfu');
    expect(diagnoseStream(sending({ limit: 'bandwidth', via: 'p2p' }))).toBe('bandwidth-p2p');
  });

  it('a rede comportar bem menos que o teto pedido aponta o caminho como gargalo, mesmo sem aviso do navegador', () => {
    expect(diagnoseStream(sending({ availableKbps: 3_000 }))).toBe('path-limit');
    expect(diagnoseStream(sending({ availableKbps: 6_000 }))).toBeNull();
    expect(diagnoseStream(sending({ availableKbps: null }))).toBeNull();
  });

  it('perda com ida e volta longa explica a travada: retransmitir demora', () => {
    expect(diagnoseStream(sending({ lossPercent: 5, rttMs: 250 }))).toBe('loss-far');
    expect(diagnoseStream(sending({ lossPercent: 5, rttMs: 30 }))).toBe('loss');
    expect(diagnoseStream(sending({ lossPercent: 5, rttMs: null }))).toBe('loss');
  });

  it('quem assiste: travadas com perda é a rede; sem perda, a origem manda poucos quadros', () => {
    expect(diagnoseStream(receiving({ freezes: 3, lossPercent: 2 }))).toBe('freezes-loss');
    expect(diagnoseStream(receiving({ freezes: 3, lossPercent: 0 }))).toBe('freezes-source');
    expect(diagnoseStream(receiving({ freezes: 1 }))).toBeNull();
    expect(diagnoseStream(receiving({ lossPercent: 6 }))).toBe('loss');
  });
});

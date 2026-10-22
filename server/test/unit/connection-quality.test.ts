import { describe, expect, it } from 'vitest';
import {
  assess,
  describeQuality,
  ownLevel,
  QUALITY_WINDOW,
  type QualityLevel,
  type QualitySample,
  worst,
} from '../../../shared/src/connection-quality.js';

/** Leituras a cada 2 s: 100 pacotes por leitura, com `lostPerRead` perdidos a mais em cada uma. */
function reads(count: number, { lostPerRead = 0, rttMs = 40 as number | null, jitterMs = 5 as number | null } = {}): QualitySample[] {
  return Array.from({ length: count }, (_, i) => ({ received: i * 100, lost: i * lostPerRead, rttMs, jitterMs }));
}

describe('assess', () => {
  it('sem leituras, não diz nada', () => {
    expect(assess([])).toBeNull();
  });

  it('rede boa', () => {
    expect(assess(reads(5))).toEqual({ level: 'good', rttMs: 40, lossPercent: 0, jitterMs: 5 });
  });

  it('só uma leitura: ping e oscilação valem, perda ainda não', () => {
    expect(assess(reads(1))).toEqual({ level: 'good', rttMs: 40, lossPercent: null, jitterMs: 5 });
    expect(assess(reads(1, { rttMs: 500 }))?.level).toBe('poor');
  });

  it.each([
    [1, 'good'],
    [2, 'fair'],
    [4.9, 'fair'],
    [5, 'poor'],
    [20, 'poor'],
  ] as const)('perda de %s%% é %s', (loss, level) => {
    // 100 recebidos por leitura e `lost` calculado para dar a perda pedida.
    const lostPerRead = (loss * 100) / (100 - loss);
    expect(assess(reads(5, { lostPerRead }))?.level).toBe(level);
  });

  it.each([
    [150, 'good'],
    [200, 'fair'],
    [399, 'fair'],
    [400, 'poor'],
  ] as const)('ping de %s ms é %s', (rttMs, level) => {
    expect(assess(reads(3, { rttMs }))?.level).toBe(level);
  });

  it.each([
    [29, 'good'],
    [30, 'fair'],
    [60, 'poor'],
  ] as const)('oscilação de %s ms é %s', (jitterMs, level) => {
    expect(assess(reads(3, { jitterMs }))?.level).toBe(level);
  });

  it('vale o pior dos três', () => {
    expect(assess(reads(5, { rttMs: 250, jitterMs: 70 }))?.level).toBe('poor');
  });

  it('ignora o que não foi medido', () => {
    expect(assess(reads(5, { rttMs: null, jitterMs: null }))).toEqual({ level: 'good', rttMs: null, lossPercent: 0, jitterMs: null });
  });

  it('com pouco áudio na janela, não calcula a perda (uma pessoa muda ou sem áudio não é "boa" nem "ruim")', () => {
    const quiet: QualitySample[] = [
      { received: 0, lost: 0, rttMs: 30, jitterMs: 2 },
      { received: 10, lost: 5, rttMs: 30, jitterMs: 2 },
    ];
    expect(assess(quiet)).toMatchObject({ lossPercent: null, level: 'good' });
  });

  it('mede a perda só na janela recente: um problema antigo passa', () => {
    // Nas primeiras leituras perdeu muito; nas últimas, nada.
    const history: QualitySample[] = [];
    let received = 0;
    let lost = 0;
    for (let i = 0; i < 12; i++) {
      received += 100;
      if (i < 4) lost += 30;
      history.push({ received, lost, rttMs: 40, jitterMs: 5 });
    }
    expect(assess(history.slice(0, 5))?.level).toBe('poor');
    expect(assess(history)?.level).toBe('good');
    expect(history.length).toBeGreaterThan(QUALITY_WINDOW);
  });

  it('a oscilação é a pior da janela; o ping é a média', () => {
    const samples = reads(5);
    samples[1]!.jitterMs = 45;
    samples[2]!.rttMs = 140;
    expect(assess(samples)).toMatchObject({ jitterMs: 45, rttMs: 60, level: 'fair' });
  });

  it('contadores que recomeçam (conexão renegociada) descartam o passado', () => {
    const samples: QualitySample[] = [
      { received: 5000, lost: 900, rttMs: 40, jitterMs: 5 },
      { received: 5100, lost: 950, rttMs: 40, jitterMs: 5 },
      { received: 20, lost: 0, rttMs: 40, jitterMs: 5 },
      { received: 120, lost: 0, rttMs: 40, jitterMs: 5 },
    ];
    expect(assess(samples)).toMatchObject({ lossPercent: 0, level: 'good' });
  });

  it('arredonda para mostrar', () => {
    const quality = assess(reads(5, { lostPerRead: 2.3, rttMs: 83.4, jitterMs: 12.6 }));
    expect(quality).toEqual({ level: 'fair', rttMs: 83, lossPercent: 2.2, jitterMs: 13 });
  });
});

describe('worst e ownLevel', () => {
  it('o pior nível', () => {
    expect(worst([])).toBe('good');
    expect(worst(['good', 'fair'])).toBe('fair');
    expect(worst(['fair', 'poor', 'good'])).toBe('poor');
  });

  it('sem pelo menos duas pessoas, não dá para saber de quem é o problema', () => {
    expect(ownLevel([])).toBeNull();
    expect(ownLevel(['poor'])).toBeNull();
  });

  it('só culpa a sua conexão quando metade ou mais vai mal', () => {
    const own = (levels: QualityLevel[]) => ownLevel(levels);
    expect(own(['good', 'poor'])).toBe('good'); // uma pessoa ruim e uma boa: é da pessoa
    expect(own(['poor', 'poor'])).toBe('poor');
    expect(own(['good', 'good', 'poor'])).toBe('good');
    expect(own(['good', 'poor', 'poor'])).toBe('poor');
    expect(own(['fair', 'poor', 'good'])).toBe('fair');
  });
});

describe('describeQuality', () => {
  it('diz o nível e os números medidos', () => {
    expect(describeQuality({ level: 'poor', rttMs: 410, lossPercent: 6.5, jitterMs: 80 })).toBe(
      'Conexão ruim (ping 410 ms, perda 6,5%, oscilação 80 ms)',
    );
    expect(describeQuality({ level: 'good', rttMs: 35, lossPercent: null, jitterMs: null })).toBe('Conexão boa (ping 35 ms)');
    expect(describeQuality({ level: 'fair', rttMs: null, lossPercent: null, jitterMs: null })).toBe('Conexão oscilando');
  });
});

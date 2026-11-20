import { describe, expect, it } from 'vitest';
import {
  initialLeveler,
  LEVELER_MAX_BOOST_DB,
  LEVELER_MAX_CUT_DB,
  LEVELER_TARGET_DB,
  levelerStep,
  LIMIT_HEADROOM,
  streamLevelerParams,
  rmsDb,
  softLimit,
  softLimitCurve,
  type LevelerState,
} from '../../../shared/src/voice-level.js';

/** Roda o nivelador por `seconds` com a fala sempre no mesmo nível, em passos de 100 ms. */
function run(level: number, seconds: number, from: LevelerState = initialLeveler()): LevelerState {
  let state = from;
  for (let t = 0; t < seconds; t += 0.1) state = levelerStep(state, level, 0.1);
  return state;
}

describe('streamLevelerParams', () => {
  it('quanto mais alto o volume acima de 100%, mais alto o nível buscado e mais ganho pode dar', () => {
    const at200 = streamLevelerParams(2);
    const at300 = streamLevelerParams(3);
    expect(at300.targetDb).toBeGreaterThan(at200.targetDb);
    expect(at300.maxBoostDb).toBeGreaterThan(at200.maxBoostDb);
  });

  it('um som que chega baixo (-34 dB) sobe bem mais que o da voz e mais ainda com o volume em 300%', () => {
    let a = initialLeveler();
    let b = initialLeveler();
    for (let t = 0; t < 30; t += 0.1) {
      a = levelerStep(a, -34, 0.1, streamLevelerParams(2));
      b = levelerStep(b, -34, 0.1, streamLevelerParams(3));
    }
    expect(a.gainDb).toBeCloseTo(18, 0); // queria 20 dB (alvo -14 dB em 200%), mas o teto é 18
    expect(b.gainDb).toBeCloseTo(24, 0); // queria 26 dB (alvo -8 dB em 300%), mas o teto é 24
  });

  it('um som já alto não é cortado mais que 6 dB', () => {
    let s = initialLeveler();
    for (let t = 0; t < 30; t += 0.1) s = levelerStep(s, -5, 0.1, streamLevelerParams(2));
    expect(s.gainDb).toBeGreaterThanOrEqual(-6);
  });
});

describe('levelerStep', () => {
  it('uma voz baixa sobe devagar até chegar perto do nível comum', () => {
    const early = run(-34, 2);
    expect(early.gainDb).toBeGreaterThan(0);
    expect(early.gainDb).toBeLessThan(6); // sobe devagar, não de uma vez
    const settled = run(-34, 30);
    expect(settled.gainDb).toBeCloseTo(LEVELER_TARGET_DB - -34, 0); // 10 dB
  });

  it('uma voz alta desce, mais rápido do que sobe', () => {
    const cut = run(-14, 2);
    expect(cut.gainDb).toBeLessThan(-3);
    const boost = run(-34, 2);
    expect(Math.abs(cut.gainDb)).toBeGreaterThan(Math.abs(boost.gainDb));
    expect(run(-14, 30).gainDb).toBeCloseTo(LEVELER_MAX_CUT_DB, 5); // queria -10 dB, mas o corte tem teto de -9
  });

  it('não passa dos limites: nem aumenta demais quem fala muito baixo, nem corta demais quem grita', () => {
    expect(run(-44, 60).gainDb).toBeCloseTo(LEVELER_MAX_BOOST_DB, 5);
    expect(run(-2, 60).gainDb).toBeCloseTo(LEVELER_MAX_CUT_DB, 5);
  });

  it('quem já está no nível comum fica como está', () => {
    expect(run(LEVELER_TARGET_DB, 20).gainDb).toBeCloseTo(0, 5);
  });

  it('em silêncio ou ruído de fundo nada muda (não aprende nem aumenta o ruído)', () => {
    const talking = run(-34, 10);
    expect(levelerStep(talking, -60, 0.1)).toBe(talking);
    expect(levelerStep(talking, -Infinity, 0.1)).toBe(talking);
    expect(levelerStep(talking, NaN, 0.1)).toBe(talking);
    expect(levelerStep(talking, -30, 0)).toBe(talking);
    expect(run(-60, 20).gainDb).toBe(0);
  });

  it('uma palavra mais fraca no meio da fala quase não mexe no ganho (o nível é uma média lenta)', () => {
    const settled = run(-24, 20);
    const after = levelerStep(settled, -40, 0.1);
    expect(Math.abs(after.gainDb - settled.gainDb)).toBeLessThan(0.3);
  });

  it('o ganho nunca muda mais que a velocidade permitida por passo', () => {
    let state = run(-34, 10);
    for (const level of [-5, -40, -3, -44]) {
      const next = levelerStep(state, level, 0.1);
      expect(Math.abs(next.gainDb - state.gainDb)).toBeLessThanOrEqual(1.0 + 1e-9); // 10 dB/s × 0,1 s
      state = next;
    }
  });
});

describe('rmsDb', () => {
  it('uma senoide de amplitude 1 tem cerca de -3 dB, e o silêncio é -Infinity', () => {
    const sine = Array.from({ length: 480 }, (_, i) => Math.sin((2 * Math.PI * i) / 48));
    expect(rmsDb(sine)).toBeCloseTo(-3.01, 1);
    expect(rmsDb(new Float32Array(100))).toBe(-Infinity);
    expect(rmsDb([])).toBe(-Infinity);
  });
});

describe('softLimit', () => {
  it('deixa passar o som normal sem mexer', () => {
    for (const x of [0, 0.1, -0.3, 0.5, -0.7, 0.7]) expect(softLimit(x)).toBe(x);
  });

  it('achata o que passa de 0,7 sem nunca ultrapassar 1, e é contínua e crescente', () => {
    let last = -Infinity;
    for (let x = 0; x <= 6; x += 0.01) {
      const y = softLimit(x);
      expect(y).toBeLessThanOrEqual(1);
      expect(y).toBeGreaterThanOrEqual(last);
      last = y;
    }
    expect(softLimit(0.71) - softLimit(0.7)).toBeLessThan(0.011);
    expect(softLimit(3)).toBeGreaterThan(0.99);
  });

  it('é simétrica', () => {
    for (const x of [0.2, 0.9, 1.5, 4]) expect(softLimit(-x)).toBeCloseTo(-softLimit(x), 12);
  });
});

describe('softLimitCurve', () => {
  it('representa -4 a 4 dentro da faixa -1 a 1 do WaveShaper (entra /4, sai ×4)', () => {
    const curve = softLimitCurve();
    expect(curve).toHaveLength(4097);
    const at = (x: number) => LIMIT_HEADROOM * curve[Math.round(((x / LIMIT_HEADROOM + 1) / 2) * 4096)]!;
    expect(at(0.5)).toBeCloseTo(0.5, 3);
    expect(at(-0.25)).toBeCloseTo(-0.25, 3);
    expect(at(2)).toBeCloseTo(softLimit(2), 3);
    expect(Math.max(...curve.map(Math.abs)) * LIMIT_HEADROOM).toBeLessThanOrEqual(1);
  });
});

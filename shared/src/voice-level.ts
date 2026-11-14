// Igualar o volume das vozes que você ouve.
//
// Cada pessoa tem um microfone, uma distância e um jeito de falar: sem ajuste, uma voz chega baixa e outra alta, e você
// fica mexendo no volume de cada uma. O nivelador mede, para cada pessoa, o nível da fala (só quando ela fala) e ajusta
// devagar o ganho dessa voz para ela ficar perto de um nível comum. É lento de propósito: ajustar rápido demais faria o
// volume "respirar" a cada palavra. Um limitador suave no fim impede que o ganho extra estoure o som.

/** O nível da fala para onde o nivelador leva cada voz (RMS, em dB abaixo do máximo). */
export const LEVELER_TARGET_DB = -24;
/** Abaixo disto não é fala (silêncio ou ruído de fundo): o nivelador não aprende nem mexe no ganho. */
export const LEVELER_SPEECH_FLOOR_DB = -45;
/** O quanto o nivelador pode aumentar a voz de alguém muito baixo, e diminuir a de alguém muito alto (dB). */
export const LEVELER_MAX_BOOST_DB = 12;
export const LEVELER_MAX_CUT_DB = -9;
/** Constante de tempo (s) com que o nível da fala de cada pessoa é estimado. */
const LEVEL_TIME_CONSTANT_S = 1.5;
/** Velocidades do ganho (dB por segundo): baixar quando alguém grita é rápido, subir é bem devagar. */
const CUT_RATE_DB_PER_S = 10;
const BOOST_RATE_DB_PER_S = 2.5;

export interface LevelerState {
  /** O nível da fala estimado (dB); `null` até ouvir a primeira fala. */
  levelDb: number | null;
  /** O ganho atual (dB). */
  gainDb: number;
}

export const initialLeveler = (): LevelerState => ({ levelDb: null, gainDb: 0 });

/**
 * Um passo do nivelador. `rmsDb` é o nível medido agora, ANTES do ganho (para o ganho não realimentar a medida) e
 * `dt` o tempo desde o passo anterior (s). Em silêncio nada muda.
 */
export function levelerStep(state: LevelerState, rmsDb: number, dt: number): LevelerState {
  if (!Number.isFinite(rmsDb) || rmsDb < LEVELER_SPEECH_FLOOR_DB || dt <= 0) return state;
  const alpha = 1 - Math.exp(-dt / LEVEL_TIME_CONSTANT_S);
  const levelDb = state.levelDb === null ? rmsDb : state.levelDb + (rmsDb - state.levelDb) * alpha;
  const wanted = Math.min(LEVELER_MAX_BOOST_DB, Math.max(LEVELER_MAX_CUT_DB, LEVELER_TARGET_DB - levelDb));
  const rate = wanted < state.gainDb ? CUT_RATE_DB_PER_S : BOOST_RATE_DB_PER_S;
  const move = Math.max(-rate * dt, Math.min(rate * dt, wanted - state.gainDb));
  return { levelDb, gainDb: state.gainDb + move };
}

/** Nível RMS de um bloco de amostras, em dB (-Infinity se for silêncio puro). */
export function rmsDb(samples: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!;
  const rms = Math.sqrt(sum / Math.max(1, samples.length));
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
}

// ── Limitador suave ──────────────────────────────────────────────────────────

/** Até onde o som passa intacto; acima disso a curva vai achatando, sem nunca passar de 1. */
const LIMIT_KNEE = 0.7;
/** Quantas vezes o sinal pode passar de 1 antes de achatar de vez (o ganho extra chega a 4×). */
export const LIMIT_HEADROOM = 4;

/** Curva do limitador: igual à entrada até 0,7 e depois achata suavemente rumo a 1 (nunca passa dele). */
export function softLimit(x: number): number {
  const a = Math.abs(x);
  if (a <= LIMIT_KNEE) return x;
  const room = 1 - LIMIT_KNEE;
  return Math.sign(x) * (LIMIT_KNEE + room * Math.tanh((a - LIMIT_KNEE) / room));
}

/**
 * A curva para um `WaveShaperNode`, que só vê entradas de -1 a 1: ela representa -4 a 4 (por isso o `LIMIT_HEADROOM`:
 * o som entra dividido por 4 e sai multiplicado por 4, e a parte que passa de 1 também é limitada).
 */
export function softLimitCurve(points = 4097): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(points);
  for (let i = 0; i < points; i++) {
    const input = ((i / (points - 1)) * 2 - 1) * LIMIT_HEADROOM;
    curve[i] = softLimit(input) / LIMIT_HEADROOM;
  }
  return curve;
}

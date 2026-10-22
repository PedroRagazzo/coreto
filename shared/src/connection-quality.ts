// Qualidade da conexão de voz com cada pessoa da chamada, a partir das estatísticas do WebRTC.
//
// Cada leitura (a cada poucos segundos, por pessoa) traz os pacotes de áudio que chegaram e os que se perderam desde
// o começo da conexão, a ida e volta da rede e a oscilação (jitter) do que chega. A perda é medida numa janela das
// últimas leituras, e não desde o começo, para o indicador reagir a um problema de agora e se recuperar quando passa.
//
// O que se mede é o caminho entre você e aquela pessoa: se todo mundo aparece ruim, o problema é provavelmente a sua
// conexão; se só uma pessoa aparece ruim, é dela (ou do caminho entre vocês dois).

export type QualityLevel = 'good' | 'fair' | 'poor';

export interface ConnectionQuality {
  level: QualityLevel;
  /** Ida e volta (ms) até a pessoa; `null` se o navegador ainda não mediu. */
  rttMs: number | null;
  /** Pacotes de áudio perdidos (%) na janela recente; `null` se chegou pouco áudio para dizer. */
  lossPercent: number | null;
  /** Oscilação (ms) do áudio que chega; `null` se não medida. */
  jitterMs: number | null;
}

/** Uma leitura das estatísticas de uma conexão. `received` e `lost` são totais acumulados desde o começo dela. */
export interface QualitySample {
  received: number;
  lost: number;
  rttMs: number | null;
  jitterMs: number | null;
}

/** Valores a partir dos quais a conexão passa a "oscilando" e a "ruim". */
const LIMITS = {
  rttMs: { fair: 200, poor: 400 },
  lossPercent: { fair: 2, poor: 5 },
  jitterMs: { fair: 30, poor: 60 },
} as const;

/** Quantas leituras entram na janela (a 2 s cada, uns 8 s). */
export const QUALITY_WINDOW = 5;
/** Menos pacotes que isso na janela não dizem nada sobre perda (o áudio chega a uns 50 por segundo). */
const MIN_PACKETS = 100;

const ORDER: QualityLevel[] = ['good', 'fair', 'poor'];

function rate(value: number | null, limits: { fair: number; poor: number }): QualityLevel {
  if (value === null) return 'good';
  return value >= limits.poor ? 'poor' : value >= limits.fair ? 'fair' : 'good';
}

/** O pior dos níveis (`good` se a lista está vazia). */
export function worst(levels: QualityLevel[]): QualityLevel {
  return levels.reduce((a, b) => (ORDER.indexOf(b) > ORDER.indexOf(a) ? b : a), 'good' as QualityLevel);
}

/**
 * A qualidade a partir das últimas leituras (da mais antiga à mais nova); `null` enquanto não há leitura.
 * Contadores que diminuem (a conexão foi renegociada e recomeçou) descartam o que veio antes.
 */
export function assess(samples: QualitySample[]): ConnectionQuality | null {
  let from = 0;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i]!.received < samples[i - 1]!.received || samples[i]!.lost < samples[i - 1]!.lost) from = i;
  }
  const recent = samples.slice(Math.max(from, samples.length - QUALITY_WINDOW));
  const last = recent.at(-1);
  if (!last) return null;

  const first = recent[0]!;
  const received = last.received - first.received;
  const lost = last.lost - first.lost;
  const lossPercent = received + lost >= MIN_PACKETS ? (lost / (received + lost)) * 100 : null;

  const jitters = recent.map((s) => s.jitterMs).filter((j): j is number => j !== null);
  const jitterMs = jitters.length ? Math.max(...jitters) : null;
  const rtts = recent.map((s) => s.rttMs).filter((r): r is number => r !== null);
  const rttMs = rtts.length ? rtts.reduce((a, b) => a + b, 0) / rtts.length : null;

  return {
    level: worst([rate(rttMs, LIMITS.rttMs), rate(lossPercent, LIMITS.lossPercent), rate(jitterMs, LIMITS.jitterMs)]),
    rttMs: rttMs === null ? null : Math.round(rttMs),
    lossPercent: lossPercent === null ? null : Math.round(lossPercent * 10) / 10,
    jitterMs: jitterMs === null ? null : Math.round(jitterMs),
  };
}

/**
 * O nível da sua própria conexão, a partir do que você mede de cada pessoa. Com duas ou mais, vale a mediana (a melhor,
 * se são duas): só aponta para você quando metade ou mais das conexões vai mal, e uma pessoa com problema não faz
 * parecer que é você. Com uma pessoa só, não dá para saber de quem é o problema.
 */
export function ownLevel(levels: QualityLevel[]): QualityLevel | null {
  if (levels.length < 2) return null;
  const sorted = [...levels].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  return sorted[Math.floor((sorted.length - 1) / 2)]!;
}

/** O texto curto da conexão, para dica ao passar o mouse e para leitores de tela. */
export function describeQuality(q: ConnectionQuality): string {
  const level = q.level === 'good' ? 'Conexão boa' : q.level === 'fair' ? 'Conexão oscilando' : 'Conexão ruim';
  const parts: string[] = [];
  if (q.rttMs !== null) parts.push(`ping ${q.rttMs} ms`);
  if (q.lossPercent !== null) parts.push(`perda ${String(q.lossPercent).replace('.', ',')}%`);
  if (q.jitterMs !== null) parts.push(`oscilação ${q.jitterMs} ms`);
  return parts.length ? `${level} (${parts.join(', ')})` : level;
}

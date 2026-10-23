// Enquetes e roletas: os limites e a conferência do que a pessoa escreveu. O formulário usa o mesmo código que o
// servidor, então o que o formulário aceita o servidor também aceita.

export const MAX_POLL_QUESTION = 200;
export const MIN_POLL_OPTIONS = 2;
export const MAX_POLL_OPTIONS = 10;
export const MAX_POLL_OPTION_LENGTH = 100;

export const MAX_ROULETTE_TITLE = 100;
export const MIN_ROULETTE_OPTIONS = 2;
export const MAX_ROULETTE_OPTIONS = 50;
export const MAX_ROULETTE_OPTION_LENGTH = 60;

/** Quanto tempo a roda leva para parar, em ms. Todo mundo anima pelo mesmo tempo, a partir do aviso do servidor. */
export const ROULETTE_SPIN_MS = 5000;

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

/** Uma linha só, sem espaços sobrando (quebras e tabulações viram espaço). */
const tidy = (raw: unknown): string => (typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '');

/** Os textos que sobram depois de arrumar; linhas vazias somem. Devolve `null` se não é uma lista de textos. */
function tidyList(raw: unknown, max: number): string[] | null {
  if (!Array.isArray(raw) || raw.length > max * 4 || !raw.every((item) => typeof item === 'string')) return null;
  return raw.map(tidy).filter(Boolean);
}

export interface NewPoll {
  question: string;
  options: string[];
  /** Cada pessoa pode marcar mais de uma opção. */
  multiple: boolean;
}

/** A enquete pronta para gravar, ou o motivo da recusa. Opções repetidas (sem diferenciar maiúsculas) não valem. */
export function checkPoll(raw: { question?: unknown; options?: unknown; multiple?: unknown }): Checked<NewPoll> {
  const question = tidy(raw.question);
  if (!question) return { ok: false, error: 'Escreva a pergunta da enquete.' };
  if (question.length > MAX_POLL_QUESTION) return { ok: false, error: `A pergunta passa de ${MAX_POLL_QUESTION} caracteres.` };

  const options = tidyList(raw.options, MAX_POLL_OPTIONS);
  if (!options) return { ok: false, error: 'Opções inválidas.' };
  if (options.length < MIN_POLL_OPTIONS) return { ok: false, error: `Escreva pelo menos ${MIN_POLL_OPTIONS} opções.` };
  if (options.length > MAX_POLL_OPTIONS) return { ok: false, error: `No máximo ${MAX_POLL_OPTIONS} opções.` };
  if (options.some((o) => o.length > MAX_POLL_OPTION_LENGTH)) {
    return { ok: false, error: `Cada opção tem no máximo ${MAX_POLL_OPTION_LENGTH} caracteres.` };
  }
  if (new Set(options.map((o) => o.toLocaleLowerCase('pt-BR'))).size !== options.length) {
    return { ok: false, error: 'Há opções repetidas.' };
  }
  return { ok: true, value: { question, options, multiple: raw.multiple === true } };
}

export interface NewRoulette {
  /** Pode ser vazio: a roleta aparece só com as opções. */
  title: string;
  options: string[];
}

/** A roleta pronta para gravar, ou o motivo da recusa. Opções repetidas valem (cada uma ganha uma fatia). */
export function checkRoulette(raw: { title?: unknown; options?: unknown }): Checked<NewRoulette> {
  const title = tidy(raw.title);
  if (title.length > MAX_ROULETTE_TITLE) return { ok: false, error: `O título passa de ${MAX_ROULETTE_TITLE} caracteres.` };

  const options = tidyList(raw.options, MAX_ROULETTE_OPTIONS);
  if (!options) return { ok: false, error: 'Opções inválidas.' };
  if (options.length < MIN_ROULETTE_OPTIONS) return { ok: false, error: `Escreva pelo menos ${MIN_ROULETTE_OPTIONS} opções.` };
  if (options.length > MAX_ROULETTE_OPTIONS) return { ok: false, error: `No máximo ${MAX_ROULETTE_OPTIONS} opções.` };
  if (options.some((o) => o.length > MAX_ROULETTE_OPTION_LENGTH)) {
    return { ok: false, error: `Cada opção tem no máximo ${MAX_ROULETTE_OPTION_LENGTH} caracteres.` };
  }
  return { ok: true, value: { title, options } };
}

/** O texto da mensagem de uma roleta (aparece em respostas, buscas e avisos): o título, ou "Roleta". */
export const rouletteContent = (title: string): string => title || 'Roleta';

/**
 * Quanto a roda gira para parar no `index` de `count` fatias, com o ponteiro fixo no alto e a fatia 0 começando no alto,
 * no sentido horário. `offset` (-0,5 a 0,5) escolhe o ponto da fatia onde o ponteiro cai; `turns` são as voltas completas.
 */
export function wheelAngle(index: number, count: number, offset = 0, turns = 6): number {
  const slice = 360 / count;
  const clamped = Math.max(-0.45, Math.min(0.45, offset));
  return turns * 360 - (index + 0.5 + clamped) * slice;
}

/** A fatia sob o ponteiro quando a roda está girada em `angle` graus. */
export function sliceAt(angle: number, count: number): number {
  const pointed = (((-angle % 360) + 360) % 360) / (360 / count);
  return Math.min(count - 1, Math.floor(pointed));
}

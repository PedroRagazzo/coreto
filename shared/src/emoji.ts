// Emojis das reações: quais valem (o servidor confere) e quais o seletor oferece (o site mostra).

/** Quantos emojis diferentes cabem numa mensagem; reagir com um novo além disso é recusado. */
export const MAX_REACTION_KINDS = 20;

const SEGMENTER = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter('pt-BR', { granularity: 'grapheme' }) : null;
const EMOJI = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}{2}|[0-9#*]️?⃣)/u;

/**
 * É um único emoji (inclusive com tom de pele, bandeira, teclado ou junção por ZWJ)? Texto, letras e vários emojis
 * juntos não valem: a reação é uma figurinha só, e o servidor guarda o que vier dentro deste limite.
 */
export function isReactionEmoji(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 32) return false;
  const graphemes = SEGMENTER ? [...SEGMENTER.segment(value)] : [value];
  return graphemes.length === 1 && EMOJI.test(value);
}

/** O que o seletor de reações oferece de cara. Qualquer outro emoji também vale se chegar de fora. */
export const REACTION_EMOJIS = [
  '👍', '👎', '❤️', '😂', '😮', '😢', '😡', '🎉',
  '🔥', '👏', '🙏', '💯', '😍', '🤔', '👀', '😅',
  '🥳', '😎', '🤯', '💀', '✅', '❌', '⭐', '🚀',
] as const;

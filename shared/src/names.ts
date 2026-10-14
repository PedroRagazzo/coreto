// Regras de nome usadas pelo servidor (validação) e pelo cliente (prévia no formulário).

import type { ChannelKind } from './models.js';

export const MAX_DISPLAY_NAME = 32;
export const MAX_SPACE_NAME = 100;

/** Nome como aparece para os outros: sem espaços sobrando. */
export function normalizeDisplayName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').slice(0, MAX_DISPLAY_NAME);
}

/** Chave de login: o nome sem diferença entre maiúsculas e minúsculas ("Ana" e "ana" são a mesma conta). */
export function loginKey(name: string): string {
  return normalizeDisplayName(name).toLocaleLowerCase('pt-BR');
}

/** O PIN tem exatamente 4 dígitos. */
export function isValidPin(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}
export const MAX_CHANNEL_NAME = 100;
export const MAX_CHANNEL_TOPIC = 1024;

/** Tópico vazio vira `null` (sem tópico). */
export function normalizeTopic(topic: string): string | null {
  return topic.trim().slice(0, MAX_CHANNEL_TOPIC) || null;
}

export function normalizeSpaceName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').slice(0, MAX_SPACE_NAME);
}

/**
 * Canais de texto viram minúsculas com hífens no lugar dos espaços ("Dúvidas Gerais" → "dúvidas-gerais").
 * Canais de voz mantêm o nome como foi digitado, só sem espaços sobrando.
 */
export function normalizeChannelName(name: string, kind: ChannelKind): string {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  const normalized =
    kind === 'text'
      ? trimmed
          .toLocaleLowerCase('pt-BR')
          .replace(/[\s_]+/g, '-')
          .replace(/[^\p{L}\p{N}-]/gu, '')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '')
      : trimmed;
  return normalized.slice(0, MAX_CHANNEL_NAME);
}

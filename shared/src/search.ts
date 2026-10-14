// Texto de busca das mensagens: sem acentos, minúsculo e sem os ids das
// menções. O servidor grava essa versão ao lado do conteúdo e compara as
// palavras da busca com ela, então "acao" encontra "Ação".

export const MAX_SEARCH_LENGTH = 200;
export const MAX_SEARCH_WORDS = 10;
export const SEARCH_PAGE_SIZE = 25;

export function searchKey(text: string): string {
  return text
    .replace(/<@[\w-]{1,64}>/g, ' ')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Palavras da busca, já normalizadas e sem repetição. */
export function searchWords(query: string): string[] {
  return [...new Set(searchKey(query.slice(0, MAX_SEARCH_LENGTH)).split(' ').filter(Boolean))].slice(
    0,
    MAX_SEARCH_WORDS,
  );
}

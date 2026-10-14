import { describe, expect, it } from 'vitest';
import { MAX_SEARCH_WORDS, searchKey, searchWords } from '../../../shared/src/search.js';

describe('searchKey', () => {
  it('tira acentos, maiúsculas, espaços extras e ids de menção', () => {
    expect(searchKey('  Ação   CORAÇÃO <@abc-123> pão ')).toBe('acao coracao pao');
  });
});

describe('searchWords', () => {
  it('separa, normaliza e remove repetidas', () => {
    expect(searchWords('Pão pao  PÃO queijo')).toEqual(['pao', 'queijo']);
  });

  it('limita o número de palavras', () => {
    const many = Array.from({ length: 20 }, (_, i) => `p${i}`).join(' ');
    expect(searchWords(many)).toHaveLength(MAX_SEARCH_WORDS);
  });
});

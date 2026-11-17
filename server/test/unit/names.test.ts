import { describe, expect, it } from 'vitest';
import {
  MAX_CHANNEL_NAME,
  MAX_CHANNEL_TOPIC,
  MAX_SPACE_NAME,
  MAX_TAG,
  TAG_COLORS,
  isTagColor,
  normalizeChannelName,
  normalizeSpaceName,
  normalizeTag,
  normalizeTopic,
} from '../../../shared/src/names.js';

describe('normalizeChannelName', () => {
  it.each([
    ['  Dúvidas Gerais ', 'dúvidas-gerais'],
    ['Ação & Reação!!', 'ação-reação'],
    ['__x__  y', 'x-y'],
    ['Sala   de   Música', 'sala-de-música'],
    ['---', ''],
  ])('canal de texto: %j vira %j', (input, expected) => {
    expect(normalizeChannelName(input, 'text')).toBe(expected);
  });

  it('mantém o nome do canal de voz como foi digitado, só sem espaços sobrando', () => {
    expect(normalizeChannelName('  Sala   de   Música ', 'voice')).toBe('Sala de Música');
  });

  it('corta no tamanho máximo', () => {
    expect(normalizeChannelName('a'.repeat(MAX_CHANNEL_NAME + 20), 'text')).toHaveLength(MAX_CHANNEL_NAME);
  });
});

describe('normalizeSpaceName', () => {
  it('junta espaços repetidos e tira os das pontas', () => {
    expect(normalizeSpaceName('  Grupo   de Estudos ')).toBe('Grupo de Estudos');
  });

  it('corta no tamanho máximo', () => {
    expect(normalizeSpaceName('x'.repeat(MAX_SPACE_NAME + 1))).toHaveLength(MAX_SPACE_NAME);
  });
});

describe('normalizeTopic', () => {
  it('transforma tópico vazio em null', () => {
    expect(normalizeTopic('   ')).toBeNull();
  });

  it('tira os espaços das pontas e corta no tamanho máximo', () => {
    expect(normalizeTopic('  Conversa livre  ')).toBe('Conversa livre');
    expect(normalizeTopic('t'.repeat(MAX_CHANNEL_TOPIC + 5))).toHaveLength(MAX_CHANNEL_TOPIC);
  });
});

describe('normalizeTag', () => {
  it('põe em maiúsculas, tira espaços sobrando e corta no tamanho máximo', () => {
    expect(normalizeTag('  amigo   do   coreto ')).toBe('AMIGO DO CORETO');
    expect(normalizeTag('robô')).toBe('ROBÔ');
    expect(normalizeTag('x'.repeat(MAX_TAG + 5))).toHaveLength(MAX_TAG);
  });

  it('etiqueta vazia vira null (sem etiqueta)', () => {
    expect(normalizeTag('   ')).toBeNull();
  });

  it('só aceita as cores da paleta', () => {
    expect(isTagColor(TAG_COLORS[0])).toBe(true);
    expect(isTagColor('#ff0000')).toBe(false);
    expect(isTagColor(42)).toBe(false);
  });
});

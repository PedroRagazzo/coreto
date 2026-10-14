import { describe, expect, it } from 'vitest';
import { decodeMentions, encodeMentions, mentionedUserIds, parseMarkup } from '../../../shared/src/markup.js';

const text = (t: string) => ({ type: 'text', text: t });

describe('parseMarkup', () => {
  it('deixa texto comum como está', () => {
    expect(parseMarkup('olá, mundo')).toEqual([text('olá, mundo')]);
    expect(parseMarkup('')).toEqual([]);
  });

  it('reconhece negrito, itálico, riscado e código', () => {
    expect(parseMarkup('**forte** *leve* _leve_ ~~fora~~ `x = 1`')).toEqual([
      { type: 'bold', children: [text('forte')] },
      text(' '),
      { type: 'italic', children: [text('leve')] },
      text(' '),
      { type: 'italic', children: [text('leve')] },
      text(' '),
      { type: 'strike', children: [text('fora')] },
      text(' '),
      { type: 'code', text: 'x = 1' },
    ]);
  });

  it('aninha formatações', () => {
    expect(parseMarkup('**muito *mesmo***')).toEqual([
      { type: 'bold', children: [text('muito '), { type: 'italic', children: [text('mesmo')] }] },
    ]);
  });

  it('não formata o que não fecha ou tem espaço colado no marcador', () => {
    expect(parseMarkup('2 * 3 * 4')).toEqual([text('2 * 3 * 4')]);
    expect(parseMarkup('**aberto')).toEqual([text('**aberto')]);
    expect(parseMarkup('`sem fim')).toEqual([text('`sem fim')]);
  });

  it('não trata sublinhado no meio de palavra como itálico', () => {
    expect(parseMarkup('nome_de_variavel e _isto_')).toEqual([
      text('nome_de_variavel e '),
      { type: 'italic', children: [text('isto')] },
    ]);
  });

  it('não formata dentro de código', () => {
    expect(parseMarkup('`**a**`')).toEqual([{ type: 'code', text: '**a**' }]);
  });

  it('escapa caracteres especiais com barra invertida', () => {
    expect(parseMarkup('\\*não é itálico\\*')).toEqual([text('*não é itálico*')]);
  });

  it('separa blocos de código com e sem linguagem', () => {
    expect(parseMarkup('antes\n```ts\nconst a = 1;\n```\ndepois')).toEqual([
      text('antes\n'),
      { type: 'codeBlock', language: 'ts', text: 'const a = 1;' },
      text('\ndepois'),
    ]);
    expect(parseMarkup('```**cru**```')).toEqual([{ type: 'codeBlock', language: null, text: '**cru**' }]);
  });

  it('transforma links http(s) em link, sem engolir a pontuação da frase', () => {
    expect(parseMarkup('veja https://exemplo.com/a?b=1.')).toEqual([
      text('veja '),
      { type: 'link', url: 'https://exemplo.com/a?b=1' },
      text('.'),
    ]);
    expect(parseMarkup('(https://pt.wikipedia.org/wiki/Coreto_(arquitetura))')).toEqual([
      text('('),
      { type: 'link', url: 'https://pt.wikipedia.org/wiki/Coreto_(arquitetura)' },
      text(')'),
    ]);
  });

  it('não cria link de outros protocolos', () => {
    expect(parseMarkup('javascript:alert(1)')).toEqual([text('javascript:alert(1)')]);
    expect(parseMarkup('http://')).toEqual([text('http://')]);
  });

  it('reconhece menções', () => {
    expect(parseMarkup('oi <@abc-123>!')).toEqual([text('oi '), { type: 'mention', userId: 'abc-123' }, text('!')]);
  });
});

describe('menções', () => {
  const people = [
    { id: 'u1', name: 'Ana' },
    { id: 'u2', name: 'Ana Clara' },
    { id: 'u3', name: 'Bruno' },
  ];

  it('codifica @Nome usando o nome mais longo que casar', () => {
    expect(encodeMentions('@ana clara e @Ana, falem com @bruno.', people)).toBe('<@u2> e <@u1>, falem com <@u3>.');
  });

  it('não codifica e-mails nem nomes que continuam', () => {
    expect(encodeMentions('ana@exemplo.com @Anastácia', people)).toBe('ana@exemplo.com @Anastácia');
  });

  it('decodifica de volta para editar', () => {
    const names: Record<string, string> = { u1: 'Ana', u2: 'Ana Clara' };
    expect(decodeMentions('<@u2> e <@u1> e <@sumiu>', (id) => names[id] ?? null)).toBe('@Ana Clara e @Ana e <@sumiu>');
  });

  it('lista quem foi mencionado, sem repetir e ignorando código', () => {
    expect(mentionedUserIds('<@u1> **<@u2>** <@u1> `<@u3>`')).toEqual(['u1', 'u2']);
  });
});

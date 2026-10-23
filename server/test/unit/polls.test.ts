import { describe, expect, it } from 'vitest';
import {
  checkPoll,
  checkRoulette,
  MAX_POLL_OPTION_LENGTH,
  MAX_POLL_OPTIONS,
  MAX_POLL_QUESTION,
  MAX_ROULETTE_OPTIONS,
  MAX_ROULETTE_OPTION_LENGTH,
  rouletteContent,
  sliceAt,
  wheelAngle,
} from '../../../shared/src/polls.js';

const ok = <T>(r: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error(r.error);
  return r.value;
};
const error = (r: { ok: boolean; error?: string }) => (r.ok ? null : r.error);

describe('checkPoll', () => {
  it('arruma os textos: espaços, quebras e linhas vazias', () => {
    const poll = ok(checkPoll({ question: '  Que   jogo\nhoje?  ', options: [' Minecraft ', '', 'Valorant\t', '   '], multiple: true }));
    expect(poll).toEqual({ question: 'Que jogo hoje?', options: ['Minecraft', 'Valorant'], multiple: true });
  });

  it('uma resposta só, a não ser que peçam várias', () => {
    expect(ok(checkPoll({ question: 'a?', options: ['x', 'y'] })).multiple).toBe(false);
    expect(ok(checkPoll({ question: 'a?', options: ['x', 'y'], multiple: 'sim' })).multiple).toBe(false);
  });

  it('exige pergunta e de duas a dez opções', () => {
    expect(error(checkPoll({ question: '   ', options: ['a', 'b'] }))).toMatch(/pergunta/);
    expect(error(checkPoll({ question: 'q', options: ['a'] }))).toMatch(/pelo menos 2/);
    expect(error(checkPoll({ question: 'q', options: ['a', ' ', ''] }))).toMatch(/pelo menos 2/);
    expect(error(checkPoll({ question: 'q', options: Array.from({ length: MAX_POLL_OPTIONS + 1 }, (_, i) => `o${i}`) }))).toMatch(/No máximo/);
    expect(ok(checkPoll({ question: 'q', options: Array.from({ length: MAX_POLL_OPTIONS }, (_, i) => `o${i}`) })).options).toHaveLength(MAX_POLL_OPTIONS);
  });

  it('limita o tamanho dos textos', () => {
    expect(error(checkPoll({ question: 'q'.repeat(MAX_POLL_QUESTION + 1), options: ['a', 'b'] }))).toMatch(/pergunta/);
    expect(error(checkPoll({ question: 'q', options: ['a', 'b'.repeat(MAX_POLL_OPTION_LENGTH + 1)] }))).toMatch(/Cada opção/);
    expect(ok(checkPoll({ question: 'q'.repeat(MAX_POLL_QUESTION), options: ['a', 'b'.repeat(MAX_POLL_OPTION_LENGTH)] }))).toBeTruthy();
  });

  it('recusa opções repetidas, sem diferenciar maiúsculas', () => {
    expect(error(checkPoll({ question: 'q', options: ['Sim', 'sim'] }))).toMatch(/repetidas/);
    expect(error(checkPoll({ question: 'q', options: ['Não  sei', 'não sei'] }))).toMatch(/repetidas/);
  });

  it('recusa o que não é texto', () => {
    expect(error(checkPoll({ question: 5, options: ['a', 'b'] }))).toMatch(/pergunta/);
    expect(error(checkPoll({ question: 'q', options: 'a,b' }))).toMatch(/inválidas/);
    expect(error(checkPoll({ question: 'q', options: ['a', { x: 1 }] }))).toMatch(/inválidas/);
    expect(error(checkPoll({ question: 'q', options: new Array(1000).fill('a') }))).toMatch(/inválidas/);
    expect(error(checkPoll({}))).toMatch(/pergunta/);
  });
});

describe('checkRoulette', () => {
  it('o título é opcional; as opções ficam na ordem em que foram escritas', () => {
    expect(ok(checkRoulette({ options: ['Minecraft', 'Valorant', 'Among Us'] }))).toEqual({ title: '', options: ['Minecraft', 'Valorant', 'Among Us'] });
    expect(ok(checkRoulette({ title: '  Que jogo? ', options: ['a', 'b'] })).title).toBe('Que jogo?');
  });

  it('aceita opções repetidas: cada uma é uma fatia', () => {
    expect(ok(checkRoulette({ options: ['a', 'a', 'b'] })).options).toEqual(['a', 'a', 'b']);
  });

  it('exige de duas a cinquenta opções', () => {
    expect(error(checkRoulette({ options: ['só uma'] }))).toMatch(/pelo menos 2/);
    expect(error(checkRoulette({ options: Array.from({ length: MAX_ROULETTE_OPTIONS + 1 }, (_, i) => `o${i}`) }))).toMatch(/No máximo/);
    expect(ok(checkRoulette({ options: Array.from({ length: MAX_ROULETTE_OPTIONS }, (_, i) => `o${i}`) })).options).toHaveLength(MAX_ROULETTE_OPTIONS);
  });

  it('limita o tamanho de cada opção e do título', () => {
    expect(error(checkRoulette({ options: ['a', 'b'.repeat(MAX_ROULETTE_OPTION_LENGTH + 1)] }))).toMatch(/Cada opção/);
    expect(error(checkRoulette({ title: 't'.repeat(101), options: ['a', 'b'] }))).toMatch(/título/);
  });

  it('o texto da mensagem é o título, ou "Roleta"', () => {
    expect(rouletteContent('Que jogo?')).toBe('Que jogo?');
    expect(rouletteContent('')).toBe('Roleta');
  });
});

describe('a roda', () => {
  it.each([2, 3, 7, 12, 50])('com %i fatias, parar em cada uma deixa o ponteiro nela', (count) => {
    for (let index = 0; index < count; index++) {
      for (const offset of [-0.4, 0, 0.4]) {
        expect(sliceAt(wheelAngle(index, count, offset), count)).toBe(index);
      }
    }
  });

  it('dá várias voltas, sempre no sentido horário (o ângulo é positivo e grande)', () => {
    expect(wheelAngle(0, 4)).toBeGreaterThan(5 * 360);
    expect(wheelAngle(3, 4, 0, 8)).toBeGreaterThan(7 * 360);
  });

  it('o ponteiro não passa do limite da fatia, por mais que peçam', () => {
    expect(sliceAt(wheelAngle(2, 5, 9), 5)).toBe(2);
    expect(sliceAt(wheelAngle(2, 5, -9), 5)).toBe(2);
  });

  it('a roda parada (ângulo 0) aponta para a primeira fatia', () => {
    expect(sliceAt(0, 6)).toBe(0);
    expect(sliceAt(360, 6)).toBe(0);
  });
});

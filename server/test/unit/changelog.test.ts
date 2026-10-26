import { describe, expect, it } from 'vitest';
import { CHANGELOG, unseenEntries, type ChangelogEntry } from '../../../shared/src/changelog.js';

const entry = (id: string): ChangelogEntry => ({ id, title: `Novidades ${id}`, items: [{ title: 'x', text: 'y' }] });
const LIST = [entry('2026-11-03'), entry('2026-10-30-2'), entry('2026-10-30'), entry('2026-10-01'), entry('2026-09-01')];

describe('unseenEntries', () => {
  it('quem nunca viu nada recebe só a mais nova, e não o histórico inteiro', () => {
    expect(unseenEntries(LIST, null).map((e) => e.id)).toEqual(['2026-11-03']);
  });

  it('quem viu a mais nova não recebe nada', () => {
    expect(unseenEntries(LIST, '2026-11-03')).toEqual([]);
  });

  it('quem ficou para trás recebe as que perdeu, da mais nova para a mais antiga', () => {
    expect(unseenEntries(LIST, '2026-10-30').map((e) => e.id)).toEqual(['2026-11-03', '2026-10-30-2']);
    expect(unseenEntries(LIST, '2026-10-30-2').map((e) => e.id)).toEqual(['2026-11-03']);
  });

  it('mostra no máximo o limite, sempre as mais novas', () => {
    expect(unseenEntries(LIST, '2026-09-01').map((e) => e.id)).toEqual(['2026-11-03', '2026-10-30-2', '2026-10-30']);
    expect(unseenEntries(LIST, '2026-09-01', 2).map((e) => e.id)).toEqual(['2026-11-03', '2026-10-30-2']);
  });

  it('um id que não existe (mais) vale como "não viu nada": só a mais nova', () => {
    expect(unseenEntries(LIST, 'id-antigo-que-sumiu').map((e) => e.id)).toEqual(['2026-11-03']);
  });

  it('lista vazia não mostra nada', () => {
    expect(unseenEntries([], null)).toEqual([]);
    expect(unseenEntries([], 'x')).toEqual([]);
  });
});

describe('CHANGELOG (o que está publicado)', () => {
  it('tem ao menos uma entrada, e cada uma tem título e novidades escritas', () => {
    expect(CHANGELOG.length).toBeGreaterThan(0);
    for (const e of CHANGELOG) {
      expect(e.title.trim()).not.toBe('');
      expect(e.items.length).toBeGreaterThan(0);
      for (const item of e.items) {
        expect(item.title.trim()).not.toBe('');
        expect(item.text.trim()).not.toBe('');
        expect(item.text.length).toBeLessThan(300); // uma ou duas frases
      }
    }
  });

  it('os ids são datas (AAAA-MM-DD, com -2, -3 se houver mais de uma no dia), únicos e da mais nova para a mais antiga', () => {
    const ids = CHANGELOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^\d{4}-\d{2}-\d{2}(-\d+)?$/);
      expect(Number.isNaN(Date.parse(id.slice(0, 10)))).toBe(false);
    }
    // Ordem: data decrescente e, no mesmo dia, o sufixo maior primeiro.
    const key = (id: string) => {
      const [, date, suffix] = /^(\d{4}-\d{2}-\d{2})(?:-(\d+))?$/.exec(id)!;
      return `${date}#${String(suffix ?? 1).padStart(4, '0')}`;
    };
    expect(ids.map(key)).toEqual([...ids.map(key)].sort().reverse());
  });
});

import { describe, expect, it } from 'vitest';
import { bestGrid } from '../../../shared/src/grid.js';

describe('bestGrid', () => {
  it('um vídeo só ocupa o que der do espaço, sem passar do formato 16:9', () => {
    expect(bestGrid({ width: 1000, height: 800, count: 1 })).toMatchObject({ columns: 1, rows: 1, tileWidth: 1000 });
    // Espaço largo e baixo: a altura é que limita.
    expect(bestGrid({ width: 1600, height: 450, count: 1 })).toMatchObject({ columns: 1, tileWidth: 800 });
  });

  it('numa janela larga, dois vídeos ficam lado a lado', () => {
    expect(bestGrid({ width: 1600, height: 700, count: 2, gap: 4 })).toMatchObject({ columns: 2, rows: 1 });
    // Numa janela quase quadrada, empilhar rende um vídeo um pouco maior, e é o que a conta escolhe.
    expect(bestGrid({ width: 1400, height: 800, count: 2, gap: 4 })).toMatchObject({ columns: 1, rows: 2 });
  });

  it('num monitor em pé, dois vídeos empilham em vez de virar tiras estreitas', () => {
    const plan = bestGrid({ width: 767, height: 1850, count: 2, gap: 4 });
    expect(plan).toMatchObject({ columns: 1, rows: 2, scrolls: false });
    expect(plan.tileWidth).toBe(767);
  });

  it('quatro vídeos numa janela larga formam 2×2', () => {
    expect(bestGrid({ width: 1400, height: 800, count: 4, gap: 4 })).toMatchObject({ columns: 2, rows: 2 });
  });

  it('o cabeçalho de cada quadro entra na conta da altura', () => {
    const without = bestGrid({ width: 1000, height: 400, count: 1 });
    const withHeader = bestGrid({ width: 1000, height: 400, count: 1, extraHeight: 40 });
    expect(withHeader.tileWidth).toBeLessThan(without.tileWidth);
    expect(withHeader.tileWidth).toBe(Math.floor((400 - 40) * (16 / 9)));
  });

  it('nunca escolhe um arranjo em que o vídeo fica menor que outro possível', () => {
    for (const [width, height, count] of [[800, 600, 3], [1200, 700, 5], [500, 1600, 6], [1920, 1000, 7]] as const) {
      const plan = bestGrid({ width, height, count, gap: 8 });
      for (let columns = 1; columns <= count; columns++) {
        const rows = Math.ceil(count / columns);
        const tile = Math.min((width - 8 * (columns - 1)) / columns, ((height - 8 * (rows - 1)) / rows) * (16 / 9));
        expect(plan.tileWidth).toBeGreaterThanOrEqual(Math.floor(tile));
      }
    }
  });

  it('com gente demais para caber no tamanho mínimo, mantém o mínimo e rola', () => {
    const plan = bestGrid({ width: 700, height: 400, count: 20, gap: 12, minTileWidth: 200 });
    expect(plan.scrolls).toBe(true);
    expect(plan.columns).toBe(3);
    expect(plan.rows).toBe(7);
    expect(plan.tileWidth).toBeGreaterThanOrEqual(200);
    // E o que cabe sem rolar não rola.
    expect(bestGrid({ width: 1400, height: 800, count: 6, gap: 12, minTileWidth: 200 }).scrolls).toBe(false);
  });

  it('sem medida ainda (espaço zerado), devolve uma coluna sem quebrar', () => {
    expect(bestGrid({ width: 0, height: 0, count: 3 })).toMatchObject({ columns: 1, rows: 3, tileWidth: 0 });
    expect(bestGrid({ width: 500, height: 500, count: 0 })).toMatchObject({ columns: 1, rows: 1 });
  });
});

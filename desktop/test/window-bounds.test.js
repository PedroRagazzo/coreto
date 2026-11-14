import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fitWindowState } from '../src/window-bounds.js';

const main = { x: 0, y: 0, width: 1920, height: 1040 };
const second = { x: 1920, y: 0, width: 2560, height: 1400 };

test('mantém posição e tamanho que cabem na tela', () => {
  assert.deepEqual(fitWindowState({ width: 1280, height: 800, x: 100, y: 50 }, [main]), { width: 1280, height: 800, x: 100, y: 50 });
});

test('guarda se estava maximizada', () => {
  assert.equal(fitWindowState({ width: 1280, height: 800, maximized: true }, [main]).maximized, true);
  assert.equal('maximized' in fitWindowState({ width: 1280, height: 800, maximized: false }, [main]), false);
});

test('a janela do segundo monitor volta para lá enquanto o monitor existe', () => {
  const saved = { width: 1280, height: 800, x: 2200, y: 100 };
  assert.deepEqual(fitWindowState(saved, [main, second]), saved);
});

test('com o segundo monitor desligado, descarta a posição para a janela não abrir fora da tela', () => {
  const out = fitWindowState({ width: 1280, height: 800, x: 2200, y: 100 }, [main]);
  assert.deepEqual(out, { width: 1280, height: 800 });
});

test('descarta a posição quando só uma beirada minúscula da janela ficaria visível', () => {
  assert.equal(fitWindowState({ width: 1280, height: 800, x: 1850, y: 0 }, [main]).x, undefined);
  assert.equal(fitWindowState({ width: 1280, height: 800, x: 0, y: 1000 }, [main]).y, undefined);
  // Metade para fora ainda dá para agarrar.
  assert.equal(fitWindowState({ width: 1280, height: 800, x: 1000, y: 100 }, [main]).x, 1000);
});

test('encolhe uma janela maior que a tela principal', () => {
  assert.deepEqual(fitWindowState({ width: 3000, height: 2000, x: 0, y: 0 }, [{ x: 0, y: 0, width: 1366, height: 728 }]), {
    width: 1366,
    height: 728,
    x: 0,
    y: 0,
  });
});

test('arquivo estragado ou vazio volta ao tamanho padrão', () => {
  for (const saved of [null, undefined, 'x', 42, [], {}, { width: 'a', height: NaN, x: 'b', y: null }, { width: -5, height: 0 }]) {
    assert.deepEqual(fitWindowState(saved, [main]), { width: 1280, height: 800 });
  }
});

test('sem informação de telas, só limpa os valores', () => {
  assert.deepEqual(fitWindowState({ width: 900, height: 600, x: 5, y: 5 }, []), { width: 900, height: 600 });
});

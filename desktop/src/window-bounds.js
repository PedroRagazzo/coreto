// @ts-check
// Posição e tamanho da janela ao abrir: o que foi guardado só vale se ainda cabe nas telas que existem agora.
//
// Sem esta conferência, quem desconecta o segundo monitor (ou troca a resolução) reabre o Coreto numa posição que não
// existe mais: a janela abre fora de qualquer tela e a pessoa não consegue nem arrastá-la de volta. Este arquivo não
// importa o Electron, para poder ser testado com `node --test`.

/** @typedef {{ x: number; y: number; width: number; height: number }} Rect */
/** @typedef {{ width: number; height: number; x?: number; y?: number; maximized?: boolean }} WindowState */

export const DEFAULT_WINDOW_SIZE = { width: 1280, height: 800 };
/** Quanto da janela precisa aparecer numa tela para ela poder ser agarrada e arrastada. */
const MIN_VISIBLE = { width: 200, height: 100 };

const isNumber = (/** @type {unknown} */ value) => typeof value === 'number' && Number.isFinite(value);

/** O pedaço de `a` que está dentro de `b` (largura e altura; 0 se não se tocam). */
function overlap(/** @type {Rect} */ a, /** @type {Rect} */ b) {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return { width: Math.max(0, width), height: Math.max(0, height) };
}

/**
 * O estado guardado, corrigido para as telas de agora. `workAreas` é a área útil de cada tela (sem a barra de tarefas);
 * a primeira é a principal. Valores que não são números são descartados; tamanho maior que a tela principal é
 * encolhido; posição que não deixa a janela aparecer em nenhuma tela é descartada (o Electron centraliza).
 * @param {unknown} saved o que veio do arquivo (pode estar estragado)
 * @param {Rect[]} workAreas
 * @returns {WindowState}
 */
export function fitWindowState(saved, workAreas) {
  const raw = saved && typeof saved === 'object' ? /** @type {Record<string, unknown>} */ (saved) : {};
  const primary = workAreas[0];
  let width = isNumber(raw.width) && /** @type {number} */ (raw.width) > 0 ? /** @type {number} */ (raw.width) : DEFAULT_WINDOW_SIZE.width;
  let height = isNumber(raw.height) && /** @type {number} */ (raw.height) > 0 ? /** @type {number} */ (raw.height) : DEFAULT_WINDOW_SIZE.height;
  if (primary) {
    width = Math.min(width, primary.width);
    height = Math.min(height, primary.height);
  }
  /** @type {WindowState} */
  const state = { width: Math.round(width), height: Math.round(height) };
  if (raw.maximized === true) state.maximized = true;

  if (isNumber(raw.x) && isNumber(raw.y)) {
    const rect = { x: /** @type {number} */ (raw.x), y: /** @type {number} */ (raw.y), width: state.width, height: state.height };
    const reachable = workAreas.some((area) => {
      const shown = overlap(rect, area);
      return shown.width >= MIN_VISIBLE.width && shown.height >= MIN_VISIBLE.height;
    });
    if (reachable) {
      state.x = Math.round(rect.x);
      state.y = Math.round(rect.y);
    }
  }
  return state;
}

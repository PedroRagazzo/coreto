// Qual novidade a pessoa já viu (a janelinha "O que há de novo"). Fica só neste navegador ou app.

import { CHANGELOG } from '@shared/changelog';

const STORAGE_KEY = 'coreto.news.seen';

/** O id da última novidade que a pessoa viu; `null` se nunca viu nenhuma (ou não dá para guardar). */
export function loadSeenNews(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Marca como vistas todas as novidades até a mais nova que existe hoje. */
export function markNewsSeen(): void {
  const latest = CHANGELOG[0]?.id;
  if (!latest) return;
  try {
    localStorage.setItem(STORAGE_KEY, latest);
  } catch {
    // Sem armazenamento a janelinha volta na próxima vez: melhor que perder a novidade.
  }
}

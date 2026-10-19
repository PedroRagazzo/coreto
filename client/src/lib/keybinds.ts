// A lógica dos atalhos (teclas, formato, conversão para o Electron) fica em shared/src/keybinds.ts,
// onde os testes alcançam. Aqui ficam só as partes que dependem da página.

export * from '@shared/keybinds';

/** Enquanto se grava um atalho novo nas configurações, os atalhos já existentes não disparam. */
export const keybindRecording = { active: false };

/** O alvo do evento é um campo de texto? Atalhos sem Ctrl/Alt/Win não devem atrapalhar quem digita. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

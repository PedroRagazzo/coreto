import { useEffect, useRef, useState } from 'react';
import { isUsableKeybind, keybindRecording, KeyTracker, keyOf, orderKeys } from './keybinds';

/** No máximo quantas teclas apertadas juntas formam um atalho. */
export const MAX_KEYS = 4;

/**
 * Grava um atalho: enquanto `recording` está ligado, as teclas apertadas não fazem o que fariam normalmente, e a
 * combinação vale quando todas são soltas. Esc cancela. `onDone` recebe a combinação pronta; `onProblem`, o motivo de
 * ela não servir (só modificadores, teclas demais).
 */
export function useKeybindRecorder(onDone: (keys: string[]) => void, onProblem: (message: string) => void) {
  const [recording, setRecording] = useState(false);
  const [held, setHeld] = useState<string[]>([]);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const onProblemRef = useRef(onProblem);
  onProblemRef.current = onProblem;

  useEffect(() => {
    if (!recording) return;
    keybindRecording.active = true;
    const tracker = new KeyTracker();
    // Tudo que foi segurado desde a primeira tecla; vale quando todas são soltas.
    const combo = new Set<string>();
    const finish = () => {
      const result = orderKeys(combo);
      setRecording(false);
      if (result.length === 0) return;
      if (result.length === 1 && result[0] === 'Escape') return; // Esc cancela
      if (!isUsableKeybind(result)) onProblemRef.current('Use também uma tecla comum, não só Shift, Ctrl, Alt ou Win.');
      else if (result.length > MAX_KEYS) onProblemRef.current(`No máximo ${MAX_KEYS} teclas juntas.`);
      else onDoneRef.current(result);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      // Enquanto grava, nenhuma tecla faz o que faria normalmente (Tab, Esc, F5...).
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      tracker.press(event);
      combo.add(keyOf(event));
      setHeld(orderKeys(combo));
    };
    const onKeyUp = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (tracker.release(event).length === 0) finish();
    };
    const cancel = () => setRecording(false);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', cancel);
    return () => {
      keybindRecording.active = false;
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', cancel);
      setHeld([]);
    };
  }, [recording]);

  return { recording, held, setRecording };
}

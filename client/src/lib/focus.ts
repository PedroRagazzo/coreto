import { useEffect, useState } from 'react';

/** A janela está em primeiro plano e à vista? Fora dela (em outro programa, minimizada), as mensagens contam como não lidas. */
export const isWindowActive = (): boolean => document.visibilityState === 'visible' && document.hasFocus();

/** Acompanha `isWindowActive` ao longo do tempo. */
export function useWindowActive(): boolean {
  const [active, setActive] = useState(isWindowActive);
  useEffect(() => {
    const update = () => setActive(isWindowActive());
    window.addEventListener('focus', update);
    window.addEventListener('blur', update);
    document.addEventListener('visibilitychange', update);
    update();
    return () => {
      window.removeEventListener('focus', update);
      window.removeEventListener('blur', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  return active;
}

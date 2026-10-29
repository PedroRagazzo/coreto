import { useEffect, useState, type RefObject } from 'react';

export interface ElementSize {
  width: number;
  height: number;
}

/**
 * O espaço interno (sem o preenchimento) de um elemento, que se atualiza quando a janela ou o painel muda de tamanho.
 * `null` até a primeira medida.
 */
export function useElementSize(ref: RefObject<HTMLElement | null>): ElementSize | null {
  const [size, setSize] = useState<ElementSize | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const read = ({ width, height }: DOMRectReadOnly) =>
      setSize((old) => (old && old.width === Math.round(width) && old.height === Math.round(height) ? old : { width: Math.round(width), height: Math.round(height) }));
    // O observador avisa logo ao começar a observar, já com o espaço interno.
    const observer = new ResizeObserver(([entry]) => entry && read(entry.contentRect));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

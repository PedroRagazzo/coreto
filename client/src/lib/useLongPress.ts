import { useEffect, useRef, type PointerEvent } from 'react';

/** O que o menu precisa do toque: onde foi e como cancelar o menu do sistema. */
export type PressPoint = Pick<PointerEvent, 'clientX' | 'clientY' | 'preventDefault'>;

/**
 * Pressão longa com o dedo (o equivalente do botão direito do mouse, que o celular não tem). Mouse não conta:
 * ele continua usando o botão direito. Soltar, sair do elemento ou o sistema assumir o gesto (rolar a tela) cancela.
 */
export function useLongPress(onLongPress: (e: PressPoint) => void, ms = 500) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callback = useRef(onLongPress);
  callback.current = onLongPress;
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => cancel, []);
  return {
    onPointerDown: (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return;
      cancel();
      const point: PressPoint = { clientX: e.clientX, clientY: e.clientY, preventDefault: () => {} };
      timer.current = setTimeout(() => {
        timer.current = null;
        callback.current(point);
      }, ms);
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
  };
}

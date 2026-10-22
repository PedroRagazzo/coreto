// Notificações do sistema (o "toast" do Windows). No app de desktop elas já vêm liberadas; no navegador a pessoa
// precisa permitir uma vez. O que merece notificação é decidido em shared/src/notify.ts.

import type { Toast } from '@shared/notify';
import { desktop } from './desktop';

export type NotificationAccess = 'granted' | 'denied' | 'default' | 'unsupported';

export function notificationAccess(): NotificationAccess {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

/** Pede a permissão ao navegador (precisa vir de um clique). Resolve com o resultado. */
export async function askNotificationAccess(): Promise<NotificationAccess> {
  if (typeof Notification === 'undefined') return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/** Traz a janela do Coreto para a frente (no desktop ela pode estar na bandeja ou minimizada). */
export function bringWindowToFront(): void {
  desktop?.focusWindow?.();
  window.focus();
}

/** Mostra a notificação; `onClick` roda quando a pessoa clica nela. Não faz nada sem permissão. */
export function showToast(toast: Toast, onClick: () => void): void {
  if (notificationAccess() !== 'granted') return;
  try {
    const notification = new Notification(toast.title, { body: toast.body, tag: toast.tag, silent: false });
    notification.onclick = () => {
      notification.close();
      bringWindowToFront();
      onClick();
    };
  } catch {
    // Alguns ambientes recusam criar notificações; o contador de não lidas continua valendo.
  }
}

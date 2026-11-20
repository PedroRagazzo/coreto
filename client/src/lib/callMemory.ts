// A chamada em que a pessoa estava quando a página foi recarregada (F5, Ctrl+F5, atualização automática do site):
// fica guardada só nesta aba (sessionStorage) e vale por pouco tempo, para voltar à sala assim que a conexão abrir.

import type { ResumableCall } from '../state/realtime/state';

const KEY = 'coreto:call-before-reload';

export type RememberedCall = ResumableCall & { droppedAt: number };

export function rememberCall(call: ResumableCall | null, at = Date.now()): void {
  try {
    if (call) sessionStorage.setItem(KEY, JSON.stringify({ ...call, droppedAt: at }));
    else sessionStorage.removeItem(KEY);
  } catch {
    // Sem armazenamento (janela privada, bloqueio): simplesmente não volta sozinho.
  }
}

export function forgetCall(): void {
  rememberCall(null);
}

/** A chamada guardada, se foi há menos de `maxAgeMs`. */
export function recallCall(maxAgeMs: number): RememberedCall | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<RememberedCall>;
    if (typeof v.channelId !== 'string' || typeof v.spaceId !== 'string' || typeof v.droppedAt !== 'number') return null;
    if (Date.now() - v.droppedAt > maxAgeMs) return null;
    return {
      channelId: v.channelId,
      spaceId: v.spaceId,
      muted: v.muted === true,
      deafened: v.deafened === true,
      streaming: v.streaming === true,
      droppedAt: v.droppedAt,
    };
  } catch {
    return null;
  }
}

import { addDrop, markBack, type ConnectionDrop } from '@shared/connection-drops';

// As últimas quedas de conexão deste aparelho, guardadas aqui mesmo (sobrevivem a recarregar a página).
const KEY = 'coreto:drops';

export function readDrops(): ConnectionDrop[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as ConnectionDrop[]) : [];
  } catch {
    return [];
  }
}

function write(list: ConnectionDrop[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // armazenamento cheio ou bloqueado: o registro é só uma ajuda
  }
}

interface NetworkInformation {
  effectiveType?: string;
  type?: string;
}

/** A conexão caiu sem a pessoa ter pedido: anota o motivo e o estado do aparelho naquela hora. */
export function recordDrop(reason: string, inCall: boolean): void {
  const connection = (navigator as unknown as { connection?: NetworkInformation }).connection;
  write(
    addDrop(readDrops(), {
      at: Date.now(),
      reason,
      inCall,
      hidden: document.visibilityState === 'hidden',
      offline: !navigator.onLine,
      ...((connection?.type ?? connection?.effectiveType) && { network: connection?.type ?? connection?.effectiveType }),
    }),
  );
}

/** A conexão voltou: anota em quanto tempo. */
export function recordBack(): void {
  const before = readDrops();
  const after = markBack(before, Date.now());
  if (after !== before) write(after);
}

export function clearDrops(): void {
  write([]);
}

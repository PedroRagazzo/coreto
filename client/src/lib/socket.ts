import type { ClientToServerEvents, ServerToClientEvents } from '@shared/protocol';
import { io, type Socket } from 'socket.io-client';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * Em desenvolvimento o Vite (5173) e o servidor (3001) rodam separados; em
 * produção o servidor entrega o site, então a API está na mesma origem.
 */
export const SERVER_URL: string =
  import.meta.env.VITE_SERVER_URL ?? (import.meta.env.DEV ? 'http://localhost:3001' : window.location.origin);

/** Cria o socket desconectado: registre os ouvintes antes de chamar connect(). */
export function createSocket(token: string): AppSocket {
  return io(SERVER_URL, { autoConnect: false, auth: { token } });
}

import type { ClientToServerEvents, ServerToClientEvents } from '@shared/protocol';
import { io, type Socket } from 'socket.io-client';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export const SERVER_URL: string = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001';

/** Cria o socket desconectado: registre os ouvintes antes de chamar connect(). */
export function createSocket(token: string): AppSocket {
  return io(SERVER_URL, { autoConnect: false, auth: { token } });
}

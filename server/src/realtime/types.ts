import type { Server, Socket } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents, SocketData } from '../../../shared/src/protocol.js';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface InterServerEvents {}

export type IO = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
export type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

/** Nomes das salas do socket.io usadas para distribuir eventos. */
export const rooms = {
  space: (spaceId: string) => `space:${spaceId}`,
  channel: (channelId: string) => `channel:${channelId}`,
  voice: (channelId: string) => `voice:${channelId}`,
};

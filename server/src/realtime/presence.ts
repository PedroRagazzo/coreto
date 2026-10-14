import type { Id, PresenceStatus } from '../../../shared/src/models.js';
import type { Store } from '../store.js';
import { rooms, type AppSocket, type IO } from './types.js';

/** Conexões abertas por usuário: várias abas contam como uma presença só. */
const connectionCount = new Map<Id, number>();

export function registerPresence(io: IO, socket: AppSocket, store: Store): void {
  const { userId } = socket.data;
  const user = store.users.get(userId);
  if (!user) return;

  const count = (connectionCount.get(userId) ?? 0) + 1;
  connectionCount.set(userId, count);
  if (count === 1) setStatus(io, store, userId, 'online');

  socket.emit('session:ready', { user, spaces: store.spacesForUser(userId) });

  socket.on('presence:set', (status) => {
    if (status === 'online' || status === 'idle' || status === 'dnd') setStatus(io, store, userId, status);
  });

  socket.on('disconnect', () => {
    const remaining = (connectionCount.get(userId) ?? 1) - 1;
    if (remaining > 0) {
      connectionCount.set(userId, remaining);
      return;
    }
    connectionCount.delete(userId);
    setStatus(io, store, userId, 'offline');
  });
}

function setStatus(io: IO, store: Store, userId: Id, status: PresenceStatus): void {
  const user = store.users.get(userId);
  if (!user || user.status === status) return;
  user.status = status;
  for (const space of store.spacesForUser(userId)) {
    io.to(rooms.space(space.id)).emit('presence:update', { userId, status });
  }
}

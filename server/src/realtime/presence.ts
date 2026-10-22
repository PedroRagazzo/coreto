import type { Id, MentionCount, PresenceStatus, UnreadCount } from '../../../shared/src/models.js';
import type { Store } from '../store.js';
import { otherParticipant } from './direct.js';
import { messageTarget } from './guards.js';
import { rooms, type AppSocket, type IO } from './types.js';

/** Conexões abertas por usuário: várias abas contam como uma presença só. */
const connectionCount = new Map<Id, number>();

export function registerPresence(io: IO, socket: AppSocket, store: Store): void {
  const { userId } = socket.data;
  const user = store.users.get(userId);
  if (!user) return;

  void socket.join(rooms.user(userId));
  const count = (connectionCount.get(userId) ?? 0) + 1;
  connectionCount.set(userId, count);
  if (count === 1) setStatus(io, store, userId, 'online');

  const directs = store.directsFor(userId);
  const directUsers = directs.flatMap((c) => store.users.get(otherParticipant(c, userId)) ?? []);
  const ready = (mentions: MentionCount[], unread: UnreadCount[]) =>
    socket.emit('session:ready', { user, spaces: store.spacesForUser(userId), directs, directUsers, mentions, unread });
  // Cada contador falha sozinho: sem ele a sessão funciona do mesmo jeito, só sem o número.
  const counted = <T>(what: string, promise: Promise<T[]>): Promise<T[]> =>
    promise.catch((err: unknown) => {
      console.error(`[session:ready] ${what}`, err);
      return [];
    });
  void Promise.all([counted('menções', store.mentionCounts(userId)), counted('não lidas', store.unreadCounts(userId))]).then(([mentions, unread]) =>
    ready(mentions, unread),
  );

  // A pessoa leu o canal ou a conversa até agora (só vale onde ela pode ler).
  socket.on('read:mark', (req) => {
    const target = messageTarget(store, userId, req?.channelId, 'read');
    if (target) store.markRead(userId, target.id).catch((err: unknown) => console.error('[read:mark]', err));
  });

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

/** Avisa quem divide um espaço e quem conversa diretamente com o usuário. */
function setStatus(io: IO, store: Store, userId: Id, status: PresenceStatus): void {
  const user = store.users.get(userId);
  if (!user || user.status === status) return;
  user.status = status;
  const audience = [
    ...store.spacesForUser(userId).map((space) => rooms.space(space.id)),
    ...store.directsFor(userId).map((c) => rooms.user(otherParticipant(c, userId))),
  ];
  if (audience.length) io.to(audience).emit('presence:update', { userId, status });
}

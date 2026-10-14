import type { Store } from '../store.js';
import { directPayload, otherParticipant, participantRooms } from './direct.js';
import { isFunction, messageTarget, storageError } from './guards.js';
import { rooms, type AppSocket, type IO } from './types.js';

const MAX_MESSAGE_LENGTH = 2000;
const MAX_HISTORY_PAGE = 100;

export function registerChat(io: IO, socket: AppSocket, store: Store): void {
  const { userId } = socket.data;

  // Entrar em um espaço: troca as salas do socket e devolve o retrato completo.
  socket.on('space:join', (spaceId, ack) => {
    if (!isFunction(ack)) return;
    const snapshot = typeof spaceId === 'string' ? store.snapshot(spaceId, userId) : null;
    if (!snapshot) return ack({ ok: false, error: 'Você não participa deste espaço.' });

    for (const room of [...socket.rooms]) {
      if (room.startsWith('space:') || room.startsWith('channel:')) void socket.leave(room);
    }
    void socket.join(rooms.space(spaceId));
    // O retrato só traz canais visíveis, então o socket só recebe o que pode ler.
    for (const channel of snapshot.channels) {
      if (channel.kind === 'text') void socket.join(rooms.channel(channel.id));
    }
    ack({ ok: true, data: snapshot });
  });

  socket.on('channel:history', async (req, ack) => {
    if (!isFunction(ack)) return;
    const target = messageTarget(store, userId, req?.channelId, 'read');
    if (!target) return ack({ ok: false, error: 'Canal indisponível.' });
    const limit = Math.min(Math.max(Number(req.limit) || 50, 1), MAX_HISTORY_PAGE);
    const before = typeof req.before === 'string' ? req.before : undefined;
    try {
      ack({ ok: true, data: await store.history(target.id, before, limit) });
    } catch (err) {
      ack(storageError('channel:history', err));
    }
  });

  socket.on('message:send', async (req, ack) => {
    if (!isFunction(ack)) return;
    const target = messageTarget(store, userId, req?.channelId, 'write');
    if (!target) return ack({ ok: false, error: 'Você não tem permissão para escrever aqui.' });
    const content = typeof req.content === 'string' ? req.content.trim() : '';
    if (!content) return ack({ ok: false, error: 'A mensagem está vazia.' });
    if (content.length > MAX_MESSAGE_LENGTH) {
      return ack({ ok: false, error: `Limite de ${MAX_MESSAGE_LENGTH} caracteres.` });
    }

    let message;
    try {
      message = await store.addMessage(target.id, userId, content);
    } catch (err) {
      return ack(storageError('message:send', err));
    }
    if (target.kind === 'channel') {
      io.to(rooms.channel(target.id)).emit('message:new', message);
    } else {
      const recipients = participantRooms(target.conversation);
      io.to(recipients).emit('dm:upsert', directPayload(store, target.conversation));
      io.to(recipients).emit('message:new', message);
    }
    ack({ ok: true, data: message });
  });

  socket.on('typing:start', (req) => {
    const target = messageTarget(store, userId, req?.channelId, 'write');
    if (!target) return;
    const room =
      target.kind === 'channel'
        ? rooms.channel(target.id)
        : rooms.user(otherParticipant(target.conversation, userId));
    socket.to(room).emit('typing', { channelId: target.id, userId });
  });
}

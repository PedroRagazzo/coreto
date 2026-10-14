import { Permission } from '../../../shared/src/permissions.js';
import type { Store } from '../store.js';
import { channelWithPermission, isFunction } from './guards.js';
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

  socket.on('channel:history', (req, ack) => {
    if (!isFunction(ack)) return;
    const channel = channelWithPermission(store, userId, req?.channelId, 'text', Permission.VIEW_CHANNEL);
    if (!channel) return ack({ ok: false, error: 'Canal indisponível.' });
    const limit = Math.min(Math.max(Number(req.limit) || 50, 1), MAX_HISTORY_PAGE);
    const before = typeof req.before === 'string' ? req.before : undefined;
    ack({ ok: true, data: store.history(channel.id, before, limit) });
  });

  socket.on('message:send', (req, ack) => {
    if (!isFunction(ack)) return;
    const channel = channelWithPermission(store, userId, req?.channelId, 'text', Permission.SEND_MESSAGES);
    if (!channel) return ack({ ok: false, error: 'Você não tem permissão para escrever neste canal.' });
    const content = typeof req.content === 'string' ? req.content.trim() : '';
    if (!content) return ack({ ok: false, error: 'A mensagem está vazia.' });
    if (content.length > MAX_MESSAGE_LENGTH) {
      return ack({ ok: false, error: `Limite de ${MAX_MESSAGE_LENGTH} caracteres.` });
    }

    const message = store.addMessage(channel.id, userId, content);
    io.to(rooms.channel(channel.id)).emit('message:new', message);
    ack({ ok: true, data: message });
  });

  socket.on('typing:start', (req) => {
    const channel = channelWithPermission(store, userId, req?.channelId, 'text', Permission.SEND_MESSAGES);
    if (channel) socket.to(rooms.channel(channel.id)).emit('typing', { channelId: channel.id, userId });
  });
}

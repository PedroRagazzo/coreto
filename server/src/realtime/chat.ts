import { hasPermission, Permission } from '../../../shared/src/permissions.js';
import { HISTORY_PAGE_SIZE, MAX_MESSAGE_LENGTH } from '../../../shared/src/protocol.js';
import type { Store } from '../store.js';
import { directPayload, otherParticipant, participantRooms } from './direct.js';
import { isFunction, messageTarget, storageError, type MessageTarget } from './guards.js';
import { rooms, type AppSocket, type IO } from './types.js';

const MAX_HISTORY_PAGE = 100;

/** Conteúdo pronto para gravar, ou o motivo da recusa. */
function validateContent(raw: unknown): { ok: true; content: string } | { ok: false; error: string } {
  const content = typeof raw === 'string' ? raw.trim() : '';
  if (!content) return { ok: false, error: 'A mensagem está vazia.' };
  if (content.length > MAX_MESSAGE_LENGTH) return { ok: false, error: `Limite de ${MAX_MESSAGE_LENGTH} caracteres.` };
  return { ok: true, content };
}

/** Quem recebe eventos de mensagens de um canal ou conversa. */
const audienceOf = (target: MessageTarget) =>
  target.kind === 'channel' ? rooms.channel(target.id) : participantRooms(target.conversation);

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
    const limit = Math.min(Math.max(Number(req.limit) || HISTORY_PAGE_SIZE, 1), MAX_HISTORY_PAGE);
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
    const valid = validateContent(req.content);
    if (!valid.ok) return ack(valid);

    let message;
    try {
      message = await store.addMessage(target.id, userId, valid.content);
    } catch (err) {
      return ack(storageError('message:send', err));
    }
    if (target.kind === 'direct') {
      io.to(audienceOf(target)).emit('dm:upsert', directPayload(store, target.conversation));
    }
    io.to(audienceOf(target)).emit('message:new', message);
    ack({ ok: true, data: message });
  });

  /** A mensagem e onde ela está, se o usuário ainda puder ler esse lugar. */
  const locate = async (messageId: unknown) => {
    const message = typeof messageId === 'string' ? await store.findMessage(messageId) : null;
    const target = message ? messageTarget(store, userId, message.channelId, 'read') : null;
    return message && target ? { message, target } : null;
  };

  socket.on('message:edit', async (req, ack) => {
    if (!isFunction(ack)) return;
    const valid = validateContent(req?.content);
    if (!valid.ok) return ack(valid);
    try {
      const found = await locate(req.messageId);
      if (!found || found.message.authorId !== userId) {
        return ack({ ok: false, error: 'Você só pode editar as suas mensagens.' });
      }
      if (found.message.content === valid.content) return ack({ ok: true, data: found.message });
      const updated = await store.editMessage(found.message.id, valid.content);
      io.to(audienceOf(found.target)).emit('message:updated', updated);
      ack({ ok: true, data: updated });
    } catch (err) {
      ack(storageError('message:edit', err));
    }
  });

  socket.on('message:delete', async (req, ack) => {
    if (!isFunction(ack)) return;
    try {
      const found = await locate(req?.messageId);
      if (!found) return ack({ ok: false, error: 'Mensagem não encontrada.' });
      const { message, target } = found;
      // Moderação só vale em canais; numa conversa direta cada um apaga só as suas.
      const moderates =
        target.kind === 'channel' &&
        hasPermission(store.permissionsFor(userId, target.channel), Permission.MANAGE_MESSAGES);
      if (message.authorId !== userId && !moderates) {
        return ack({ ok: false, error: 'Você só pode apagar as suas mensagens.' });
      }
      await store.deleteMessage(message.id);
      io.to(audienceOf(target)).emit('message:deleted', { channelId: message.channelId, messageId: message.id });
      ack({ ok: true, data: null });
    } catch (err) {
      ack(storageError('message:delete', err));
    }
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

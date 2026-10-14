import { mentionedUserIds } from '../../../shared/src/markup.js';
import { SEARCH_PAGE_SIZE, searchWords } from '../../../shared/src/search.js';
import type { Channel, Id } from '../../../shared/src/models.js';
import { hasPermission, Permission } from '../../../shared/src/permissions.js';
import {
  HISTORY_PAGE_SIZE,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_MESSAGE_LENGTH,
} from '../../../shared/src/protocol.js';
import { AttachmentUnavailableError, type Store } from '../store.js';
import type { UploadDir } from '../uploads.js';
import { directPayload, otherParticipant, participantRooms } from './direct.js';
import { isFunction, messageTarget, storageError, type MessageTarget } from './guards.js';
import { rooms, type AppSocket, type IO } from './types.js';

const MAX_HISTORY_PAGE = 100;

/** Conteúdo pronto para gravar, ou o motivo da recusa. Vazio só vale para mensagem com anexos. */
function validateContent(raw: unknown, allowEmpty = false): { ok: true; content: string } | { ok: false; error: string } {
  const content = typeof raw === 'string' ? raw.trim() : '';
  if (!content && !allowEmpty) return { ok: false, error: 'A mensagem está vazia.' };
  if (content.length > MAX_MESSAGE_LENGTH) return { ok: false, error: `Limite de ${MAX_MESSAGE_LENGTH} caracteres.` };
  return { ok: true, content };
}

/** Ids de anexos do pedido; `null` se o formato for inválido. */
function readAttachmentIds(raw: unknown): Id[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > MAX_ATTACHMENTS_PER_MESSAGE) return null;
  if (!raw.every((id) => typeof id === 'string') || new Set(raw).size !== raw.length) return null;
  return raw as Id[];
}

/**
 * Quem a mensagem menciona de verdade: só em canais (numa conversa direta a
 * outra pessoa já é avisada), sem o autor, sem robôs e só quem enxerga o canal.
 */
function mentionTargets(store: Store, target: MessageTarget, content: string, authorId: Id): Id[] {
  if (target.kind !== 'channel') return [];
  return mentionedUserIds(content).filter((id) => {
    const user = store.users.get(id);
    return (
      user !== undefined &&
      !user.isBot &&
      id !== authorId &&
      hasPermission(store.permissionsFor(id, target.channel), Permission.VIEW_CHANNEL)
    );
  });
}

/** Manda a cada pessoa o novo total de menções não vistas no canal. */
async function notifyMentions(io: IO, store: Store, userIds: Id[], channel: Channel): Promise<void> {
  for (const userId of new Set(userIds)) {
    const count = await store.mentionCount(userId, channel.id);
    io.to(rooms.user(userId)).emit('mentions:update', { channelId: channel.id, spaceId: channel.spaceId, count });
  }
}

const logError = (context: string) => (err: unknown) => console.error(`[${context}]`, err);

/** Quem recebe eventos de mensagens de um canal ou conversa. */
const audienceOf = (target: MessageTarget) =>
  target.kind === 'channel' ? rooms.channel(target.id) : participantRooms(target.conversation);

export function registerChat(io: IO, socket: AppSocket, store: Store, uploads: UploadDir): void {
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
    const after = typeof req.after === 'string' ? req.after : undefined;
    try {
      ack({ ok: true, data: await store.history(target.id, { before, after }, limit) });
    } catch (err) {
      ack(storageError('channel:history', err));
    }
  });

  socket.on('message:send', async (req, ack) => {
    if (!isFunction(ack)) return;
    const target = messageTarget(store, userId, req?.channelId, 'write');
    if (!target) return ack({ ok: false, error: 'Você não tem permissão para escrever aqui.' });
    const attachmentIds = readAttachmentIds(req.attachmentIds);
    if (!attachmentIds) return ack({ ok: false, error: `Até ${MAX_ATTACHMENTS_PER_MESSAGE} imagens por mensagem.` });
    const valid = validateContent(req.content, attachmentIds.length > 0);
    if (!valid.ok) return ack(valid);
    const mentions = mentionTargets(store, target, valid.content, userId);

    let message;
    try {
      message = await store.addMessage(target.id, userId, valid.content, { attachmentIds, mentions });
    } catch (err) {
      if (err instanceof AttachmentUnavailableError) return ack({ ok: false, error: err.message });
      return ack(storageError('message:send', err));
    }
    if (target.kind === 'direct') {
      io.to(audienceOf(target)).emit('dm:upsert', directPayload(store, target.conversation));
    }
    io.to(audienceOf(target)).emit('message:new', message);
    ack({ ok: true, data: message });
    if (target.kind === 'channel' && mentions.length > 0) {
      notifyMentions(io, store, mentions, target.channel).catch(logError('mentions'));
    }
  });

  /** A mensagem e onde ela está, se o usuário ainda puder ler esse lugar. */
  const locate = async (messageId: unknown) => {
    const message = typeof messageId === 'string' ? await store.findMessage(messageId) : null;
    const target = message ? messageTarget(store, userId, message.channelId, 'read') : null;
    return message && target ? { message, target } : null;
  };

  socket.on('message:edit', async (req, ack) => {
    if (!isFunction(ack)) return;
    try {
      const found = await locate(req?.messageId);
      if (!found || found.message.authorId !== userId) {
        return ack({ ok: false, error: 'Você só pode editar as suas mensagens.' });
      }
      const { message, target } = found;
      const valid = validateContent(req.content, message.attachments.length > 0);
      if (!valid.ok) return ack(valid);
      if (message.content === valid.content) return ack({ ok: true, data: message });

      // Só quem entrou na mensagem com a edição é avisado; quem saiu perde a menção não vista.
      const before = mentionTargets(store, target, message.content, userId);
      const after = mentionTargets(store, target, valid.content, userId);
      const added = after.filter((id) => !before.includes(id));
      const removed = before.filter((id) => !after.includes(id));
      const updated = await store.editMessage(
        message.id,
        valid.content,
        target.kind === 'channel' ? { channelId: target.id, added, removed } : undefined,
      );
      io.to(audienceOf(target)).emit('message:updated', updated);
      ack({ ok: true, data: updated });
      if (target.kind === 'channel' && added.length + removed.length > 0) {
        notifyMentions(io, store, [...added, ...removed], target.channel).catch(logError('mentions'));
      }
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
      const mentioned = await store.mentionedIn(message.id);
      await store.deleteMessage(message.id);
      io.to(audienceOf(target)).emit('message:deleted', { channelId: message.channelId, messageId: message.id });
      ack({ ok: true, data: null });
      uploads.remove(message.attachments.map((a) => a.id)).catch(logError('upload'));
      if (target.kind === 'channel' && mentioned.length > 0) {
        notifyMentions(io, store, mentioned, target.channel).catch(logError('mentions'));
      }
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

  socket.on('message:context', async (req, ack) => {
    if (!isFunction(ack)) return;
    try {
      const found = await locate(req?.messageId);
      if (!found) return ack({ ok: false, error: 'Mensagem não encontrada.' });
      const context = await store.context(found.message);
      ack({ ok: true, data: { channelId: found.message.channelId, ...context } });
    } catch (err) {
      ack(storageError('message:context', err));
    }
  });

  socket.on('message:search', async (req, ack) => {
    if (!isFunction(ack)) return;
    const words = typeof req?.text === 'string' ? searchWords(req.text) : [];
    const authorId = typeof req?.authorId === 'string' ? req.authorId : undefined;
    const channelId = typeof req?.channelId === 'string' ? req.channelId : undefined;
    const has = req?.has === 'image' || req?.has === 'link' ? req.has : undefined;
    const before = typeof req?.before === 'string' ? req.before : undefined;
    if (words.length === 0 && !authorId && !channelId && !has) {
      return ack({ ok: false, error: 'Digite algo ou escolha um filtro para buscar.' });
    }

    // Só onde a pessoa pode ler: os canais de texto visíveis do espaço, ou uma conversa dela.
    const scope = (req?.scope ?? {}) as Partial<Record<'spaceId' | 'directId', unknown>>;
    let where: { channelIds: Id[] } | { directId: Id };
    if (typeof scope.directId === 'string') {
      const conversation = store.directFor(userId, scope.directId);
      if (!conversation) return ack({ ok: false, error: 'Conversa indisponível.' });
      where = { directId: conversation.id };
    } else if (typeof scope.spaceId === 'string' && store.member(scope.spaceId, userId)) {
      const readable = [...store.channels.values()].filter(
        (c) =>
          c.spaceId === scope.spaceId &&
          c.kind === 'text' &&
          (!channelId || c.id === channelId) &&
          hasPermission(store.permissionsFor(userId, c), Permission.VIEW_CHANNEL),
      );
      where = { channelIds: readable.map((c) => c.id) };
    } else {
      return ack({ ok: false, error: 'Espaço indisponível.' });
    }

    try {
      ack({ ok: true, data: await store.search({ ...where, words, authorId, has, before }, SEARCH_PAGE_SIZE) });
    } catch (err) {
      ack(storageError('message:search', err));
    }
  });

  socket.on('mentions:ack', async (req) => {
    const channel = typeof req?.channelId === 'string' ? store.channels.get(req.channelId) : undefined;
    if (!channel) return;
    try {
      await store.clearMentions(userId, channel.id);
    } catch (err) {
      return logError('mentions:ack')(err);
    }
    // Para todas as abas da pessoa.
    io.to(rooms.user(userId)).emit('mentions:update', { channelId: channel.id, spaceId: channel.spaceId, count: 0 });
  });
}

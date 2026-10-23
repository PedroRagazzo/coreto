import { randomInt } from 'node:crypto';
import { MAX_REACTION_KINDS, isReactionEmoji } from '../../../shared/src/emoji.js';
import { mentionedUserIds } from '../../../shared/src/markup.js';
import { SEARCH_PAGE_SIZE, searchWords } from '../../../shared/src/search.js';
import type { Channel, Id, Message } from '../../../shared/src/models.js';
import { hasPermission, Permission } from '../../../shared/src/permissions.js';
import { checkPoll, checkRoulette, rouletteContent } from '../../../shared/src/polls.js';
import {
  HISTORY_PAGE_SIZE,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_MESSAGE_LENGTH,
} from '../../../shared/src/protocol.js';
import { AttachmentUnavailableError, type Store } from '../store.js';
import type { UploadDir } from '../uploads.js';
import { directPayload, otherParticipant, participantRooms } from './direct.js';
import { bumpUnread } from './unread.js';
import { isFunction, messageTarget, storageError, type MessageTarget } from './guards.js';
import { rooms, type AppSocket, type IO } from './types.js';

const MAX_HISTORY_PAGE = 100;
/** No máximo isto de reações por socket nesta janela: um clique nervoso passa, uma enxurrada não. */
const REACTION_BURST = 20;
const REACTION_WINDOW_MS = 5000;
/** Votos, encerramentos e giros: o mesmo tipo de limite, para um clique nervoso passar e uma enxurrada não. */
const POLL_BURST = 30;

/** Devolve uma função que diz se mais um evento cabe agora: no máximo `max` por janela de `windowMs`. */
function burstLimiter(max: number, windowMs: number): () => boolean {
  const recent: number[] = [];
  return () => {
    const now = Date.now();
    while (recent.length > 0 && now - recent[0] > windowMs) recent.shift();
    recent.push(now);
    return recent.length <= max;
  };
}

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
function mentionTargets(store: Store, target: MessageTarget, content: string, authorId: Id, alsoNotify: Id[] = []): Id[] {
  if (target.kind !== 'channel') return [];
  return [...new Set([...mentionedUserIds(content), ...alsoNotify])].filter((id) => {
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

export function registerChat(
  io: IO,
  socket: AppSocket,
  store: Store,
  uploads: UploadDir,
  /** Chamado para cada mensagem nova de canal (o bot de música lê os comandos aqui). */
  onChannelMessage: (message: Message, channel: Channel) => void = () => {},
): void {
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
    // Responder: a original precisa estar neste mesmo canal ou conversa; quem escreveu a original é avisado como numa menção.
    const replyToId = typeof req.replyToId === 'string' ? req.replyToId : null;
    let repliedAuthor: Id | null = null;
    if (replyToId) {
      try {
        repliedAuthor = await store.authorOfMessageIn(target.id, replyToId);
      } catch (err) {
        return ack(storageError('message:send', err));
      }
      if (!repliedAuthor) return ack({ ok: false, error: 'A mensagem que você quer responder não existe mais.' });
    }
    const mentions = mentionTargets(store, target, valid.content, userId, repliedAuthor ? [repliedAuthor] : []);

    let message;
    try {
      message = await store.addMessage(target.id, userId, valid.content, { attachmentIds, mentions, replyToId });
    } catch (err) {
      if (err instanceof AttachmentUnavailableError) return ack({ ok: false, error: err.message });
      return ack(storageError('message:send', err));
    }
    if (target.kind === 'direct') {
      io.to(audienceOf(target)).emit('dm:upsert', directPayload(store, target.conversation));
    }
    io.to(audienceOf(target)).emit('message:new', message);
    bumpUnread(io, store, target.id, userId);
    ack({ ok: true, data: message });
    if (target.kind === 'channel') {
      onChannelMessage(message, target.channel);
      if (mentions.length > 0) notifyMentions(io, store, mentions, target.channel).catch(logError('mentions'));
    }
  });

  /** A mensagem e onde ela está, se o usuário ainda puder ler esse lugar. */
  const locate = async (messageId: unknown) => {
    const message = typeof messageId === 'string' ? await store.findMessage(messageId) : null;
    const target = message ? messageTarget(store, userId, message.channelId, 'read') : null;
    return message && target ? { message, target } : null;
  };

  // Reagir vale onde a pessoa pode ler (como no Discord, dá para reagir em canais só de leitura).
  const reactionAllowed = burstLimiter(REACTION_BURST, REACTION_WINDOW_MS);
  socket.on('reaction:toggle', async (req, ack) => {
    if (!isFunction(ack)) return;
    if (!reactionAllowed()) return ack({ ok: false, error: 'Devagar: muitas reações seguidas.' });
    if (!isReactionEmoji(req?.emoji)) return ack({ ok: false, error: 'Esse emoji não vale como reação.' });
    try {
      const found = await locate(req?.messageId);
      if (!found) return ack({ ok: false, error: 'Mensagem não encontrada.' });
      const { message, target } = found;
      const result = await store.toggleReaction(message.id, userId, req.emoji, MAX_REACTION_KINDS);
      if (result === 'full') return ack({ ok: false, error: `Esta mensagem já tem ${MAX_REACTION_KINDS} emojis diferentes.` });
      const reactions = await store.reactionsOf(message.id);
      io.to(audienceOf(target)).emit('message:reactions', { channelId: message.channelId, messageId: message.id, reactions });
      ack({ ok: true, data: null });
    } catch (err) {
      ack(storageError('reaction:toggle', err));
    }
  });

  // ── Enquetes e roletas ───────────────────────────────────────────────────────

  /** Publica uma mensagem de enquete ou roleta, como qualquer outra mensagem do canal (menções, não lidas, tudo igual). */
  const postSpecial = async (
    target: MessageTarget,
    ack: (res: { ok: true; data: Message } | { ok: false; error: string }) => void,
    content: string,
    extra: NonNullable<Parameters<Store['addMessage']>[3]>,
  ) => {
    const mentions = mentionTargets(store, target, content, userId);
    let message;
    try {
      message = await store.addMessage(target.id, userId, content, { ...extra, mentions });
    } catch (err) {
      return ack(storageError('poll:create', err));
    }
    if (target.kind === 'direct') io.to(audienceOf(target)).emit('dm:upsert', directPayload(store, target.conversation));
    io.to(audienceOf(target)).emit('message:new', message);
    bumpUnread(io, store, target.id, userId);
    ack({ ok: true, data: message });
    // Não passa pelo bot de música: a pergunta de uma enquete nunca vira um comando.
    if (target.kind === 'channel' && mentions.length > 0) notifyMentions(io, store, mentions, target.channel).catch(logError('mentions'));
  };

  socket.on('poll:create', async (req, ack) => {
    if (!isFunction(ack)) return;
    const target = messageTarget(store, userId, req?.channelId, 'write');
    if (!target) return ack({ ok: false, error: 'Você não tem permissão para escrever aqui.' });
    const checked = checkPoll(req ?? {});
    if (!checked.ok) return ack(checked);
    await postSpecial(target, ack, checked.value.question, { poll: checked.value });
  });

  socket.on('roulette:create', async (req, ack) => {
    if (!isFunction(ack)) return;
    const target = messageTarget(store, userId, req?.channelId, 'write');
    if (!target) return ack({ ok: false, error: 'Você não tem permissão para escrever aqui.' });
    const checked = checkRoulette(req ?? {});
    if (!checked.ok) return ack(checked);
    await postSpecial(target, ack, rouletteContent(checked.value.title), { roulette: checked.value });
  });

  // Votar e girar valem onde a pessoa pode ler, como reagir (num canal só de leitura dá para votar).
  const pollActionAllowed = burstLimiter(POLL_BURST, REACTION_WINDOW_MS);

  socket.on('poll:vote', async (req, ack) => {
    if (!isFunction(ack)) return;
    if (!pollActionAllowed()) return ack({ ok: false, error: 'Devagar: muitos votos seguidos.' });
    try {
      const found = await locate(req?.messageId);
      if (!found?.message.poll) return ack({ ok: false, error: 'Enquete não encontrada.' });
      if (typeof req.optionId !== 'string') return ack({ ok: false, error: 'Opção não encontrada.' });
      const { message, target } = found;
      const poll = await store.toggleVote(message.id, req.optionId, userId);
      if (poll === 'closed') return ack({ ok: false, error: 'Esta enquete já foi encerrada.' });
      if (poll === 'unknown') return ack({ ok: false, error: 'Opção não encontrada.' });
      io.to(audienceOf(target)).emit('poll:updated', { channelId: message.channelId, messageId: message.id, poll });
      ack({ ok: true, data: null });
    } catch (err) {
      ack(storageError('poll:vote', err));
    }
  });

  socket.on('poll:close', async (req, ack) => {
    if (!isFunction(ack)) return;
    if (!pollActionAllowed()) return ack({ ok: false, error: 'Devagar.' });
    try {
      const found = await locate(req?.messageId);
      if (!found?.message.poll) return ack({ ok: false, error: 'Enquete não encontrada.' });
      const { message, target } = found;
      const moderates =
        target.kind === 'channel' &&
        hasPermission(store.permissionsFor(userId, target.channel), Permission.MANAGE_MESSAGES);
      if (message.authorId !== userId && !moderates) {
        return ack({ ok: false, error: 'Só quem criou a enquete pode encerrá-la.' });
      }
      const poll = await store.closePoll(message.id);
      if (!poll) return ack({ ok: false, error: 'Enquete não encontrada.' });
      io.to(audienceOf(target)).emit('poll:updated', { channelId: message.channelId, messageId: message.id, poll });
      ack({ ok: true, data: null });
    } catch (err) {
      ack(storageError('poll:close', err));
    }
  });

  socket.on('roulette:spin', async (req, ack) => {
    if (!isFunction(ack)) return;
    if (!pollActionAllowed()) return ack({ ok: false, error: 'Devagar.' });
    try {
      const found = await locate(req?.messageId);
      if (!found?.message.roulette) return ack({ ok: false, error: 'Roleta não encontrada.' });
      const { message, target } = found;
      // Sorteio com o gerador criptográfico do servidor: ninguém escolhe nem prevê o resultado.
      const roulette = await store.spinRoulette(message.id, userId, (count) => randomInt(count));
      if (roulette === 'already') return ack({ ok: false, error: 'Esta roleta já foi girada.' });
      if (roulette === 'unknown') return ack({ ok: false, error: 'Roleta não encontrada.' });
      io.to(audienceOf(target)).emit('roulette:spun', { channelId: message.channelId, messageId: message.id, roulette });
      ack({ ok: true, data: null });
    } catch (err) {
      ack(storageError('roulette:spin', err));
    }
  });

  socket.on('message:edit', async (req, ack) => {
    if (!isFunction(ack)) return;
    try {
      const found = await locate(req?.messageId);
      if (!found || found.message.authorId !== userId) {
        return ack({ ok: false, error: 'Você só pode editar as suas mensagens.' });
      }
      const { message, target } = found;
      if (message.poll || message.roulette) {
        return ack({ ok: false, error: 'Enquetes e roletas não podem ser editadas. Apague e crie de novo.' });
      }
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

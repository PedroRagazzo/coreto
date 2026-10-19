// Criação, edição e exclusão de espaços e de canais.

import type { Id } from '../../../shared/src/models.js';
import { normalizeChannelName, normalizeSpaceName, normalizeTopic } from '../../../shared/src/names.js';
import { hasPermission, Permission } from '../../../shared/src/permissions.js';
import type { Store } from '../store.js';
import { isFunction, storageError } from './guards.js';
import { rooms, type AppSocket, type IO } from './types.js';
import { endVoiceSession } from './voice.js';

export function registerManagement(io: IO, socket: AppSocket, store: Store): void {
  const { userId } = socket.data;

  // Qualquer pessoa pode criar um espaço; quem cria vira dono.
  socket.on('space:create', async (req, ack) => {
    if (!isFunction(ack)) return;
    const name = typeof req?.name === 'string' ? normalizeSpaceName(req.name) : '';
    if (!name) return ack({ ok: false, error: 'Dê um nome ao espaço.' });
    try {
      const space = await store.createSpace(name, userId);
      // Todo espaço é público: todos os usuários já viraram membros dele.
      io.emit('space:created', space);
      ack({ ok: true, data: space });
    } catch (err) {
      ack(storageError('space:create', err));
    }
  });

  socket.on('space:update', async (req, ack) => {
    if (!isFunction(ack)) return;
    const spaceId = typeof req?.spaceId === 'string' ? req.spaceId : '';
    if (!hasPermission(store.spacePermissionsFor(userId, spaceId), Permission.ADMINISTRATOR)) {
      return ack({ ok: false, error: 'Só administradores podem editar o espaço.' });
    }
    const name = typeof req.name === 'string' ? normalizeSpaceName(req.name) : '';
    if (!name) return ack({ ok: false, error: 'Dê um nome ao espaço.' });
    try {
      const space = await store.updateSpace(spaceId, name);
      io.emit('space:updated', space);
      ack({ ok: true, data: space });
    } catch (err) {
      ack(storageError('space:update', err));
    }
  });

  // Excluir apaga tudo de todo mundo: só o dono (ou o administrador geral) pode.
  socket.on('space:delete', async (req, ack) => {
    if (!isFunction(ack)) return;
    const space = typeof req?.spaceId === 'string' ? store.spaces.get(req.spaceId) : undefined;
    if (!space || (space.ownerId !== userId && !store.isSuperAdmin(userId))) {
      return ack({ ok: false, error: 'Só o dono pode excluir o espaço.' });
    }

    // Guarda o que vai sumir da memória antes de apagar.
    const channelIds = [...store.channels.values()].filter((c) => c.spaceId === space.id).map((c) => c.id);
    const voiceSessions = [...store.voice.values()].filter((v) => v.spaceId === space.id);
    try {
      await store.deleteSpace(space.id);
    } catch (err) {
      return ack(storageError('space:delete', err));
    }

    for (const session of voiceSessions) {
      endVoiceSession(io, store, session, `O espaço ${space.name} foi excluído.`);
    }
    io.socketsLeave([rooms.space(space.id), ...channelIds.map(rooms.channel)]);
    io.emit('space:deleted', { spaceId: space.id });
    ack({ ok: true, data: null });
  });

  // Criar canal exige MANAGE_CHANNELS no espaço.
  socket.on('channel:create', async (req, ack) => {
    if (!isFunction(ack)) return;
    const spaceId = typeof req?.spaceId === 'string' ? req.spaceId : '';
    if (!hasPermission(store.spacePermissionsFor(userId, spaceId), Permission.MANAGE_CHANNELS)) {
      return ack({ ok: false, error: 'Você não tem permissão para criar canais neste espaço.' });
    }
    const kind = req.kind === 'voice' ? 'voice' : req.kind === 'text' ? 'text' : null;
    if (!kind) return ack({ ok: false, error: 'Tipo de canal inválido.' });
    const categoryId = typeof req.categoryId === 'string' ? req.categoryId : null;
    if (categoryId && !store.categoryIn(spaceId, categoryId)) {
      return ack({ ok: false, error: 'Categoria inválida.' });
    }
    const name = typeof req.name === 'string' ? normalizeChannelName(req.name, kind) : '';
    if (!name) return ack({ ok: false, error: 'Dê um nome ao canal.' });

    let channel;
    try {
      channel = await store.createChannel({ spaceId, categoryId, name, kind });
    } catch (err) {
      return ack(storageError('channel:create', err));
    }

    // Cada pessoa com o espaço aberto recebe o canal com as próprias permissões,
    // e só se puder vê-lo; quem pode ler um canal de texto passa a ouvir as mensagens dele.
    for (const other of await io.in(rooms.space(spaceId)).fetchSockets()) {
      const permissions = store.permissionsFor(other.data.userId, channel);
      if (permissions === 0) continue;
      if (channel.kind === 'text') other.join(rooms.channel(channel.id));
      other.emit('channel:created', { channel, permissions });
    }
    ack({ ok: true, data: { channel, permissions: store.permissionsFor(userId, channel) } });
  });

  /** O canal, se ele existir e o usuário puder gerenciar canais no espaço dele. */
  const manageableChannel = (channelId: unknown) => {
    const channel = typeof channelId === 'string' ? store.channels.get(channelId) : undefined;
    if (!channel) return null;
    return hasPermission(store.spacePermissionsFor(userId, channel.spaceId), Permission.MANAGE_CHANNELS) ? channel : null;
  };

  socket.on('channel:update', async (req, ack) => {
    if (!isFunction(ack)) return;
    const channel = manageableChannel(req?.channelId);
    if (!channel) return ack({ ok: false, error: 'Você não tem permissão para editar este canal.' });

    const patch: { name?: string; topic?: string | null; categoryId?: string | null } = {};
    if (req.name !== undefined) {
      const name = typeof req.name === 'string' ? normalizeChannelName(req.name, channel.kind) : '';
      if (!name) return ack({ ok: false, error: 'Dê um nome ao canal.' });
      patch.name = name;
    }
    if (req.topic !== undefined && channel.kind === 'text') {
      patch.topic = typeof req.topic === 'string' ? normalizeTopic(req.topic) : null;
    }
    if (req.categoryId !== undefined) {
      const categoryId = typeof req.categoryId === 'string' ? req.categoryId : null;
      if (categoryId && !store.categoryIn(channel.spaceId, categoryId)) {
        return ack({ ok: false, error: 'Categoria inválida.' });
      }
      patch.categoryId = categoryId;
    }

    let updated;
    try {
      updated = await store.updateChannel(channel.id, patch);
    } catch (err) {
      return ack(storageError('channel:update', err));
    }
    // Como na criação, só quem pode ver o canal recebe o nome e o tópico novos.
    for (const other of await io.in(rooms.space(updated.spaceId)).fetchSockets()) {
      if (store.permissionsFor(other.data.userId, updated) !== 0) other.emit('channel:updated', updated);
    }
    ack({ ok: true, data: updated });
  });

  socket.on('channel:delete', async (req, ack) => {
    if (!isFunction(ack)) return;
    const channel = manageableChannel(req?.channelId);
    if (!channel) return ack({ ok: false, error: 'Você não tem permissão para excluir este canal.' });
    let mentioned: Id[];
    try {
      mentioned = await store.mentionedInChannel(channel.id);
      await store.deleteChannel(channel.id);
    } catch (err) {
      return ack(storageError('channel:delete', err));
    }

    // Quem tinha menções ali pode estar em outro espaço e não receber `channel:deleted`.
    for (const userId of mentioned) {
      io.to(rooms.user(userId)).emit('mentions:update', { channelId: channel.id, spaceId: channel.spaceId, count: 0 });
    }
    for (const session of store.voiceIn(channel.id)) {
      endVoiceSession(io, store, session, 'O canal de voz em que você estava foi excluído.');
    }
    io.socketsLeave(rooms.channel(channel.id));
    io.to(rooms.space(channel.spaceId)).emit('channel:deleted', { spaceId: channel.spaceId, channelId: channel.id });
    ack({ ok: true, data: null });
  });
}

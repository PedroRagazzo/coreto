// Criação de espaços e canais.

import { normalizeChannelName, normalizeSpaceName } from '../../../shared/src/names.js';
import { hasPermission, Permission } from '../../../shared/src/permissions.js';
import type { Store } from '../store.js';
import { isFunction, storageError } from './guards.js';
import { rooms, type AppSocket, type IO } from './types.js';

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
}

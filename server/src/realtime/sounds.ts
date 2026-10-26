import { Permission, hasPermission } from '../../../shared/src/permissions.js';
import type { Store } from '../store.js';
import type { UploadDir } from '../uploads.js';
import { isFunction, storageError } from './guards.js';
import { rooms, type AppSocket, type IO } from './types.js';

/** Avisa o espaço de que a lista de sons mudou (a lista inteira, já atualizada). */
export async function announceSounds(io: IO, store: Store, spaceId: string): Promise<void> {
  io.to(rooms.space(spaceId)).emit('sounds:updated', { spaceId, clips: await store.soundsOf(spaceId) });
}

/** Lista e remoção dos sons de um espaço. O envio é pelo HTTP (POST /sounds, ver sounds.ts). */
export function registerSounds(io: IO, socket: AppSocket, store: Store, uploads: UploadDir): void {
  const { userId } = socket.data;

  socket.on('sounds:list', async (req, ack) => {
    if (!isFunction(ack)) return;
    if (typeof req?.spaceId !== 'string' || !store.member(req.spaceId, userId)) {
      return ack({ ok: false, error: 'Você não participa deste espaço.' });
    }
    try {
      ack({ ok: true, data: await store.soundsOf(req.spaceId) });
    } catch (err) {
      ack(storageError('sounds:list', err));
    }
  });

  // Quem enviou o som, ou quem gerencia os canais do espaço, remove.
  socket.on('sound:remove', async (req, ack) => {
    if (!isFunction(ack)) return;
    try {
      const clip = typeof req?.id === 'string' ? await store.findSound(req.id) : null;
      if (!clip || !store.member(clip.spaceId, userId)) return ack({ ok: false, error: 'Som não encontrado.' });
      const manages = hasPermission(store.spacePermissionsFor(userId, clip.spaceId), Permission.MANAGE_CHANNELS);
      if (clip.uploaderId !== userId && !manages) return ack({ ok: false, error: 'Só quem enviou o som pode removê-lo.' });
      await store.deleteSound(clip.id);
      await uploads.remove([clip.id]);
      await announceSounds(io, store, clip.spaceId);
      ack({ ok: true, data: null });
    } catch (err) {
      ack(storageError('sound:remove', err));
    }
  });
}

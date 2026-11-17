// Ações só do administrador geral (os nomes de SUPER_ADMIN_NAMES).

import { TOO_FAST, type RateLimits } from '../rate-limit.js';
import type { Store } from '../store.js';
import type { UploadDir } from '../uploads.js';
import { isFunction, storageError } from './guards.js';
import { rooms, type AppSocket, type IO } from './types.js';
import { endVoiceSession } from './voice.js';

export function registerAdmin(io: IO, socket: AppSocket, store: Store, uploads: UploadDir, limits: RateLimits): void {
  const { userId } = socket.data;

  // Excluir uma conta não tem volta: só o administrador geral, e nunca ele mesmo, um robô ou outro administrador geral.
  socket.on('account:delete', async (req, ack) => {
    if (!isFunction(ack)) return;
    if (!store.isSuperAdmin(userId)) return ack({ ok: false, error: 'Só o administrador geral pode excluir contas.' });
    if (!limits.manage.take(userId)) return ack(TOO_FAST);
    const target = typeof req?.userId === 'string' ? store.users.get(req.userId) : undefined;
    if (!target) return ack({ ok: false, error: 'Essa conta não existe mais.' });
    if (target.id === userId) return ack({ ok: false, error: 'Você não pode excluir a própria conta.' });
    if (target.isBot) return ack({ ok: false, error: 'Os robôs não são contas de pessoas.' });
    if (store.isSuperAdmin(target.id)) {
      return ack({ ok: false, error: 'Não dá para excluir outro administrador geral. Tire o nome dele de SUPER_ADMIN_NAMES antes.' });
    }

    // A sala de voz ainda precisa da conta para montar a lista, então a chamada acaba antes.
    const call = store.voice.get(target.id);
    if (call) endVoiceSession(io, store, call, 'Sua conta foi excluída.');
    let attachmentIds: string[];
    try {
      attachmentIds = await store.deleteAccount(target.id, userId);
    } catch (err) {
      return ack(storageError('account:delete', err));
    }
    uploads.remove(attachmentIds).catch((err: unknown) => console.error('[account:delete] arquivos', err));

    // Quem estava com a conta aberta (qualquer aba) é desconectado, e sem sessão não volta.
    io.in(rooms.user(target.id)).disconnectSockets(true);
    io.emit('account:deleted', { userId: target.id });
    ack({ ok: true, data: null });
  });
}

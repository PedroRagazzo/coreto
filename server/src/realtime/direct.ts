// Conversas diretas: só entre pessoas que compartilham pelo menos um espaço.
// As mensagens usam os mesmos eventos dos canais (ver chat.ts); a entrega vai
// para a sala `user:{id}` de cada participante, que cobre todas as abas.

import type { DirectConversation, Id } from '../../../shared/src/models.js';
import type { DirectConversationPayload } from '../../../shared/src/protocol.js';
import type { Store } from '../store.js';
import { isFunction } from './guards.js';
import { rooms, type AppSocket } from './types.js';

export function directPayload(store: Store, conversation: DirectConversation): DirectConversationPayload {
  return {
    conversation,
    users: conversation.participantIds.flatMap((id) => store.users.get(id) ?? []),
  };
}

export function otherParticipant(conversation: DirectConversation, userId: Id): Id {
  const [a, b] = conversation.participantIds;
  return a === userId ? b : a;
}

export const participantRooms = (conversation: DirectConversation) => conversation.participantIds.map(rooms.user);

export function registerDirect(socket: AppSocket, store: Store): void {
  const { userId } = socket.data;

  socket.on('dm:open', (req, ack) => {
    if (!isFunction(ack)) return;
    const target = typeof req?.userId === 'string' ? store.users.get(req.userId) : undefined;
    if (!target || target.id === userId) return ack({ ok: false, error: 'Usuário inválido.' });
    if (target.isBot) return ack({ ok: false, error: 'Robôs não recebem mensagens diretas.' });
    if (!store.sharesSpace(userId, target.id)) {
      return ack({ ok: false, error: 'Vocês precisam participar de um espaço em comum.' });
    }
    // A conversa só aparece para o outro lado quando a primeira mensagem chegar.
    ack({ ok: true, data: directPayload(store, store.directBetween(userId, target.id)) });
  });
}

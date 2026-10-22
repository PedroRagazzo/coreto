// Mensagens não lidas ao vivo: cada mensagem nova avisa quem a lê, na sala pessoal (`user:<id>`), que há mais uma
// não lida. Vai pela sala pessoal, e não pela do canal, para chegar também a quem está em outro espaço ou
// em outra tela. O total certo vem do banco quando a pessoa entra (store.unreadCounts).

import type { Id } from '../../../shared/src/models.js';
import type { Store } from '../store.js';
import { rooms, type IO } from './types.js';

/** Avisa quem lê o canal ou a conversa `targetId` que `authorId` escreveu algo novo. */
export function bumpUnread(io: IO, store: Store, targetId: Id, authorId: Id): void {
  const spaceId = store.channels.get(targetId)?.spaceId ?? null;
  for (const userId of store.unreadRecipients(targetId, authorId)) {
    io.to(rooms.user(userId)).emit('unread:bump', { channelId: targetId, spaceId });
  }
}

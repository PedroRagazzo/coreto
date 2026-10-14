import type { Id } from '../../../shared/src/models.js';
import type { Store } from '../store.js';
import { rooms, type IO } from './types.js';

/** No protótipo todos os espaços são públicos: quem conecta vira membro de todos. */
export async function joinPublicSpaces(io: IO, store: Store, userId: Id): Promise<void> {
  const user = store.users.get(userId);
  if (!user) return;
  for (const space of store.spaces.values()) {
    if (store.member(space.id, userId)) continue;
    const member = await store.addMember(space.id, userId);
    io.to(rooms.space(space.id)).emit('member:joined', { member, user });
  }
}

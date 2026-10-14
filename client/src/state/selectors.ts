import type { MentionCandidate } from '@shared/markup';
import type { Category, Channel, Id, SpaceSnapshot, User } from '@shared/models';
import { hasPermission } from '@shared/permissions';
import type { RealtimeState } from './realtime';

export function can(snapshot: SpaceSnapshot | null, channelId: Id | undefined, flag: number): boolean {
  if (!snapshot || !channelId) return false;
  return hasPermission(snapshot.permissions[channelId] ?? 0, flag);
}

export function displayNameOf(snapshot: SpaceSnapshot | null, users: Record<Id, User>, userId: Id): string {
  const nickname = snapshot?.members.find((m) => m.userId === userId)?.nickname;
  return nickname ?? users[userId]?.displayName ?? 'Usuário desconhecido';
}

/** Cor do cargo mais alto (com cor) do membro, para pintar o nome. */
export function roleColorOf(snapshot: SpaceSnapshot | null, userId: Id): string | undefined {
  const member = snapshot?.members.find((m) => m.userId === userId);
  if (!snapshot || !member) return undefined;
  const colored = snapshot.roles
    .filter((r) => member.roleIds.includes(r.id) && r.color)
    .sort((a, b) => b.position - a.position);
  return colored[0]?.color ?? undefined;
}

export interface ChannelGroup {
  category: Category | null;
  channels: Channel[];
}

/**
 * Canais sem categoria primeiro, depois cada categoria na ordem definida.
 * Categorias vazias só aparecem com `includeEmpty` (para quem pode criar canais nelas).
 */
export function groupChannels(snapshot: SpaceSnapshot, includeEmpty = false): ChannelGroup[] {
  const uncategorized = snapshot.channels.filter((c) => c.categoryId === null);
  const groups: ChannelGroup[] = uncategorized.length ? [{ category: null, channels: uncategorized }] : [];
  for (const category of snapshot.categories) {
    const channels = snapshot.channels.filter((c) => c.categoryId === category.id);
    if (channels.length || includeEmpty) groups.push({ category, channels });
  }
  return groups;
}

/**
 * Quem dá para mencionar numa conversa: os membros do espaço num canal (o
 * servidor ainda descarta quem não enxerga o canal) ou os dois lados de uma
 * conversa direta. Robôs ficam de fora.
 */
export function mentionCandidates(state: RealtimeState, targetId: Id): MentionCandidate[] {
  const { snapshot, users } = state;
  const ids = snapshot?.channels.some((c) => c.id === targetId)
    ? snapshot.members.map((m) => m.userId)
    : (state.directs[targetId]?.participantIds ?? []);
  return ids
    .filter((id) => users[id] && !users[id].isBot)
    .map((id) => ({ id, name: displayNameOf(snapshot, users, id) }));
}

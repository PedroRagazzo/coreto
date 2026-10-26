// Conversão entre as linhas do Prisma e os modelos de domínio de shared/.

import type {
  Attachment,
  Category,
  Channel,
  DirectConversation,
  Member,
  Message,
  PermissionOverwrite,
  Poll,
  Reaction,
  Role,
  Roulette,
  SoundClip,
  Space,
  User,
} from '../../../shared/src/models.js';
import { deletedReply, replyPreviewOf } from '../../../shared/src/reply.js';
import type * as Db from '../generated/prisma/client.js';

const iso = (date: Date | null): string | null => date?.toISOString() ?? null;

export const toUser = (row: Db.User): User => ({
  id: row.id,
  displayName: row.displayName,
  avatarColor: row.avatarColor,
  // Presença não é persistida: todo mundo começa indisponível, menos robôs.
  status: row.isBot ? 'online' : 'offline',
  isBot: row.isBot,
});

export const toSpace = (row: Db.Space): Space => ({
  id: row.id,
  name: row.name,
  ownerId: row.ownerId,
  iconUrl: row.iconUrl,
});

export const toRole = (row: Db.Role): Role => ({
  id: row.id,
  spaceId: row.spaceId,
  name: row.name,
  color: row.color,
  position: row.position,
  permissions: Number(row.permissions),
  hoist: row.hoist,
});

export const toCategory = (row: Db.Category): Category => ({
  id: row.id,
  spaceId: row.spaceId,
  name: row.name,
  position: row.position,
});

const toOverwrite = (row: Db.PermissionOverwrite): PermissionOverwrite => ({
  targetType: row.targetType === 'ROLE' ? 'role' : 'member',
  targetId: row.targetId,
  allow: Number(row.allow),
  deny: Number(row.deny),
});

export const toChannel = (row: Db.Channel & { overwrites: Db.PermissionOverwrite[] }): Channel => ({
  id: row.id,
  spaceId: row.spaceId,
  categoryId: row.categoryId,
  name: row.name,
  kind: row.kind === 'TEXT' ? 'text' : 'voice',
  position: row.position,
  topic: row.topic,
  overwrites: row.overwrites.map(toOverwrite),
});

export const toMember = (row: Db.Member & { roles: { roleId: string }[] }): Member => ({
  spaceId: row.spaceId,
  userId: row.userId,
  nickname: row.nickname,
  roleIds: row.roles.map((r) => r.roleId),
  joinedAt: row.joinedAt.toISOString(),
});

export const toDirect = (row: Db.DirectConversation): DirectConversation => ({
  id: row.id,
  participantIds: [row.userAId, row.userBId],
  lastMessageAt: iso(row.lastMessageAt),
});

export const toSound = (row: Db.SoundClip): SoundClip => ({
  id: row.id,
  spaceId: row.spaceId,
  name: row.name,
  emoji: row.emoji,
  uploaderId: row.uploaderId,
  contentType: row.contentType,
  size: row.size,
  createdAt: row.createdAt.toISOString(),
});

export const toAttachment = (row: Db.Attachment): Attachment => ({
  id: row.id,
  fileName: row.fileName,
  contentType: row.contentType,
  size: row.size,
  width: row.width,
  height: row.height,
});

/** As opções de uma enquete em ordem, cada uma com quem votou (na ordem dos votos). */
export const pollOptionInclude = {
  orderBy: { position: 'asc' },
  include: { votes: { orderBy: { createdAt: 'asc' }, select: { userId: true } } },
} as const;

/** Use com `include: messageInclude` nas consultas de mensagens. */
export const messageInclude = {
  attachments: { orderBy: { position: 'asc' } },
  // Em ordem de criação: o primeiro a reagir com cada emoji define a posição dele na lista.
  reactions: { orderBy: { createdAt: 'asc' } },
  poll: { include: { options: pollOptionInclude } },
  roulette: true,
} as const;

type PollRow = Db.Poll & { options: (Db.PollOption & { votes: Pick<Db.PollVote, 'userId'>[] })[] };

type MessageRow = Db.Message & {
  attachments: Db.Attachment[];
  reactions: Db.Reaction[];
  poll: PollRow | null;
  roulette: Db.Roulette | null;
};

export const toPoll = (row: PollRow): Poll => ({
  multiple: row.multiple,
  closed: row.closedAt !== null,
  options: row.options.map((o) => ({ id: o.id, text: o.text, userIds: o.votes.map((v) => v.userId) })),
});

export const toRoulette = (row: Db.Roulette): Roulette => ({
  options: row.options,
  result: row.resultIndex,
  spunAt: iso(row.spunAt),
  spunById: row.spunById,
});

/** O que se lê da mensagem respondida, para o resumo acima da resposta. */
export interface ReplyParentRow {
  id: string;
  authorId: string;
  content: string;
  _count: { attachments: number };
}

/** O que buscar das mensagens respondidas (ver `ReplyParentRow`). */
export const replyParentSelect = { id: true, authorId: true, content: true, _count: { select: { attachments: true } } } as const;

/** Agrupa as linhas por emoji, na ordem em que cada emoji apareceu pela primeira vez. */
export function toReactions(rows: Pick<Db.Reaction, 'emoji' | 'userId'>[]): Reaction[] {
  const byEmoji = new Map<string, string[]>();
  for (const { emoji, userId } of rows) {
    const users = byEmoji.get(emoji);
    if (users) users.push(userId);
    else byEmoji.set(emoji, [userId]);
  }
  return [...byEmoji].map(([emoji, userIds]) => ({ emoji, userIds }));
}

/** `parents` traz as mensagens respondidas; as que não estão lá foram apagadas. */
export const toMessage = (row: MessageRow, parents: ReadonlyMap<string, ReplyParentRow> = new Map()): Message => ({
  id: row.id,
  // A restrição Message_target_check garante que exatamente um dos dois existe.
  channelId: (row.channelId ?? row.directId)!,
  authorId: row.authorId,
  content: row.content,
  attachments: row.attachments.map(toAttachment),
  createdAt: row.createdAt.toISOString(),
  editedAt: iso(row.editedAt),
  replyTo: row.replyToId ? replyPreviewFor(row.replyToId, parents.get(row.replyToId)) : null,
  reactions: toReactions(row.reactions),
  pinnedAt: iso(row.pinnedAt),
  pinnedById: row.pinnedById,
  poll: row.poll ? toPoll(row.poll) : null,
  roulette: row.roulette ? toRoulette(row.roulette) : null,
});

function replyPreviewFor(id: string, parent: ReplyParentRow | undefined) {
  return parent
    ? replyPreviewOf({ id: parent.id, authorId: parent.authorId, content: parent.content, attachments: new Array(parent._count.attachments) })
    : deletedReply(id);
}

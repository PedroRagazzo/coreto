// Conversão entre as linhas do Prisma e os modelos de domínio de shared/.

import type {
  Attachment,
  Category,
  Channel,
  DirectConversation,
  Member,
  Message,
  PermissionOverwrite,
  Role,
  Space,
  User,
} from '../../../shared/src/models.js';
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

export const toAttachment = (row: Db.Attachment): Attachment => ({
  id: row.id,
  fileName: row.fileName,
  contentType: row.contentType,
  size: row.size,
  width: row.width,
  height: row.height,
});

/** Use com `include: messageInclude` nas consultas de mensagens. */
export const messageInclude = { attachments: { orderBy: { position: 'asc' } } } as const;

export const toMessage = (row: Db.Message & { attachments: Db.Attachment[] }): Message => ({
  id: row.id,
  // A restrição Message_target_check garante que exatamente um dos dois existe.
  channelId: (row.channelId ?? row.directId)!,
  authorId: row.authorId,
  content: row.content,
  attachments: row.attachments.map(toAttachment),
  createdAt: row.createdAt.toISOString(),
  editedAt: iso(row.editedAt),
});

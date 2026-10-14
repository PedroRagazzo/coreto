// Armazenamento em memória. A interface pública é a mesma que um repositório
// com banco (ver prisma/schema.prisma) precisará oferecer.

import { randomUUID } from 'node:crypto';
import type {
  Category,
  Channel,
  ChannelKind,
  DirectConversation,
  Id,
  Member,
  Message,
  PermissionOverwrite,
  Role,
  Space,
  SpaceSnapshot,
  User,
  VoiceParticipant,
} from '../../shared/src/models.js';
import { DEFAULT_EVERYONE_PERMISSIONS } from '../../shared/src/permissions.js';
import { computeChannelPermissions } from './permissions.js';

const AVATAR_COLORS = ['#2bb39a', '#5b8def', '#b07de0', '#e5a54b', '#e06c75', '#4fb3c8', '#8cbf5a'];
const HISTORY_LIMIT_PER_CHANNEL = 500;

/** Sessão de voz de um usuário: no máximo uma por conta, presa ao socket que entrou. */
export interface VoiceSession extends VoiceParticipant {
  spaceId: Id;
  socketId: string;
}

export const toParticipant = ({ userId, channelId, muted, deafened }: VoiceSession): VoiceParticipant => ({
  userId,
  channelId,
  muted,
  deafened,
});

const byPosition = (a: { position: number }, b: { position: number }) => a.position - b.position;

export class Store {
  readonly users = new Map<Id, User>();
  readonly spaces = new Map<Id, Space>();
  readonly channels = new Map<Id, Channel>();
  /** userId → sessão de voz ativa */
  readonly voice = new Map<Id, VoiceSession>();
  readonly directs = new Map<Id, DirectConversation>();

  private readonly tokens = new Map<string, Id>();
  private readonly categories = new Map<Id, Category>();
  private readonly roles = new Map<Id, Role>();
  private readonly members = new Map<string, Member>();
  private readonly messages = new Map<Id, Message[]>();

  // ── Usuários ───────────────────────────────────────────────────────────────

  createUser(displayName: string, options: { isBot?: boolean } = {}): User {
    const user: User = {
      id: randomUUID(),
      displayName,
      avatarColor: AVATAR_COLORS[this.users.size % AVATAR_COLORS.length],
      status: options.isBot ? 'online' : 'offline',
      isBot: options.isBot ?? false,
    };
    this.users.set(user.id, user);
    return user;
  }

  /**
   * Autenticação provisória: o navegador gera um token aleatório e o guarda no
   * localStorage. Substituir por login de verdade (OAuth, senha + JWT) antes de produção.
   */
  resolveSession(token: string, displayName: string): User {
    const existing = this.users.get(this.tokens.get(token) ?? '');
    if (existing) {
      existing.displayName = displayName;
      return existing;
    }
    const user = this.createUser(displayName);
    this.tokens.set(token, user.id);
    return user;
  }

  // ── Espaços, cargos, categorias e canais ───────────────────────────────────

  createSpace(name: string, ownerId: Id): Space {
    const space: Space = { id: randomUUID(), name, ownerId, iconUrl: null };
    this.spaces.set(space.id, space);
    this.roles.set(space.id, {
      id: space.id,
      spaceId: space.id,
      name: '@everyone',
      color: null,
      position: 0,
      permissions: DEFAULT_EVERYONE_PERMISSIONS,
      hoist: false,
    });
    this.addMember(space.id, ownerId);
    return space;
  }

  createRole(input: Omit<Role, 'id'>): Role {
    const role: Role = { id: randomUUID(), ...input };
    this.roles.set(role.id, role);
    return role;
  }

  createCategory(spaceId: Id, name: string): Category {
    const position = [...this.categories.values()].filter((c) => c.spaceId === spaceId).length;
    const category: Category = { id: randomUUID(), spaceId, name, position };
    this.categories.set(category.id, category);
    return category;
  }

  createChannel(input: {
    spaceId: Id;
    categoryId: Id | null;
    name: string;
    kind: ChannelKind;
    topic?: string | null;
    overwrites?: PermissionOverwrite[];
  }): Channel {
    const position = [...this.channels.values()].filter(
      (c) => c.spaceId === input.spaceId && c.categoryId === input.categoryId,
    ).length;
    const channel: Channel = {
      id: randomUUID(),
      spaceId: input.spaceId,
      categoryId: input.categoryId,
      name: input.name,
      kind: input.kind,
      position,
      topic: input.topic ?? null,
      overwrites: input.overwrites ?? [],
    };
    this.channels.set(channel.id, channel);
    if (channel.kind === 'text') this.messages.set(channel.id, []);
    return channel;
  }

  // ── Membros ────────────────────────────────────────────────────────────────

  addMember(spaceId: Id, userId: Id, roleIds: Id[] = []): Member {
    const member: Member = { spaceId, userId, nickname: null, roleIds, joinedAt: new Date().toISOString() };
    this.members.set(`${spaceId}:${userId}`, member);
    return member;
  }

  member(spaceId: Id, userId: Id): Member | null {
    return this.members.get(`${spaceId}:${userId}`) ?? null;
  }

  spacesForUser(userId: Id): Space[] {
    return [...this.spaces.values()].filter((space) => this.members.has(`${space.id}:${userId}`));
  }

  permissionsFor(userId: Id, channel: Channel): number {
    const space = this.spaces.get(channel.spaceId);
    const member = this.member(channel.spaceId, userId);
    if (!space || !member) return 0;
    const roles = [...this.roles.values()].filter((r) => r.spaceId === space.id);
    return computeChannelPermissions({ space, member, roles, channel });
  }

  snapshot(spaceId: Id, userId: Id): SpaceSnapshot | null {
    const space = this.spaces.get(spaceId);
    if (!space || !this.member(spaceId, userId)) return null;

    const permissions: Record<Id, number> = {};
    const channels: Channel[] = [];
    for (const channel of this.channels.values()) {
      if (channel.spaceId !== spaceId) continue;
      const effective = this.permissionsFor(userId, channel);
      if (effective === 0) continue;
      permissions[channel.id] = effective;
      channels.push(channel);
    }

    const members = [...this.members.values()].filter((m) => m.spaceId === spaceId);
    return {
      space,
      categories: [...this.categories.values()].filter((c) => c.spaceId === spaceId).sort(byPosition),
      channels: channels.sort(byPosition),
      roles: [...this.roles.values()].filter((r) => r.spaceId === spaceId).sort(byPosition),
      members,
      users: members.flatMap((m) => this.users.get(m.userId) ?? []),
      voice: [...this.voice.values()].filter((v) => permissions[v.channelId] !== undefined).map(toParticipant),
      permissions,
    };
  }

  sharesSpace(a: Id, b: Id): boolean {
    return this.spacesForUser(a).some((space) => this.members.has(`${space.id}:${b}`));
  }

  // ── Conversas diretas ──────────────────────────────────────────────────────

  /** Devolve a conversa entre duas pessoas, criando-a na primeira vez. */
  directBetween(a: Id, b: Id): DirectConversation {
    for (const conversation of this.directs.values()) {
      const [x, y] = conversation.participantIds;
      if ((x === a && y === b) || (x === b && y === a)) return conversation;
    }
    const conversation: DirectConversation = { id: randomUUID(), participantIds: [a, b], lastMessageAt: null };
    this.directs.set(conversation.id, conversation);
    this.messages.set(conversation.id, []);
    return conversation;
  }

  /** A conversa, se ela existir e o usuário participar dela. */
  directFor(userId: Id, conversationId: Id): DirectConversation | null {
    const conversation = this.directs.get(conversationId);
    return conversation?.participantIds.includes(userId) ? conversation : null;
  }

  /** Conversas com pelo menos uma mensagem, da mais recente para a mais antiga. */
  directsFor(userId: Id): DirectConversation[] {
    return [...this.directs.values()]
      .filter((c) => c.lastMessageAt !== null && c.participantIds.includes(userId))
      .sort((a, b) => b.lastMessageAt!.localeCompare(a.lastMessageAt!));
  }

  // ── Mensagens ──────────────────────────────────────────────────────────────

  /** Mensagens em ordem cronológica; `before` pagina para trás a partir de uma mensagem. */
  history(channelId: Id, before?: Id, limit = 50): Message[] {
    const list = this.messages.get(channelId) ?? [];
    const index = before ? list.findIndex((m) => m.id === before) : -1;
    const end = index === -1 ? list.length : index;
    return list.slice(Math.max(0, end - limit), end);
  }

  addMessage(channelId: Id, authorId: Id, content: string): Message {
    const message: Message = {
      id: randomUUID(),
      channelId,
      authorId,
      content,
      createdAt: new Date().toISOString(),
      editedAt: null,
    };
    const list = this.messages.get(channelId);
    if (!list) throw new Error(`Canal de texto ou conversa inexistente: ${channelId}`);
    list.push(message);
    const direct = this.directs.get(channelId);
    if (direct) direct.lastMessageAt = message.createdAt;
    if (list.length > HISTORY_LIMIT_PER_CHANNEL) list.splice(0, list.length - HISTORY_LIMIT_PER_CHANNEL);
    return message;
  }

  // ── Voz ────────────────────────────────────────────────────────────────────

  voiceIn(channelId: Id): VoiceSession[] {
    return [...this.voice.values()].filter((v) => v.channelId === channelId);
  }
}

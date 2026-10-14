// Estado do servidor sobre o PostgreSQL (Prisma).
//
// A estrutura (usuários, espaços, cargos, categorias, canais, membros e conversas
// diretas) é carregada do banco ao iniciar e fica em memória: as checagens de
// permissão rodam a cada evento e precisam ser síncronas. Toda escrita vai
// primeiro ao banco e só depois atualiza a memória. Mensagens não ficam em
// memória: são gravadas e lidas direto do banco. Presença e voz são efêmeras.
//
// Com uma instância só do servidor isso basta; com várias, a memória de cada
// uma precisaria ser invalidada (por exemplo via Redis pub/sub).

import type {
  Category,
  Channel,
  DirectConversation,
  Id,
  Member,
  Message,
  Role,
  Space,
  SpaceSnapshot,
  User,
  VoiceParticipant,
} from '../../shared/src/models.js';
import { hashToken, type Db } from './db/client.js';
import {
  toCategory,
  toChannel,
  toDirect,
  toMember,
  toMessage,
  toRole,
  toSpace,
  toUser,
} from './db/mappers.js';
import { computeChannelPermissions } from './permissions.js';

const AVATAR_COLORS = ['#2bb39a', '#5b8def', '#b07de0', '#e5a54b', '#e06c75', '#4fb3c8', '#8cbf5a'];

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
const memberKey = (spaceId: Id, userId: Id) => `${spaceId}:${userId}`;

export class Store {
  readonly users = new Map<Id, User>();
  readonly spaces = new Map<Id, Space>();
  readonly channels = new Map<Id, Channel>();
  readonly directs = new Map<Id, DirectConversation>();
  /** userId → sessão de voz ativa */
  readonly voice = new Map<Id, VoiceSession>();

  private readonly categories = new Map<Id, Category>();
  private readonly roles = new Map<Id, Role>();
  private readonly members = new Map<string, Member>();

  private constructor(private readonly db: Db) {}

  /** Carrega a estrutura inteira do banco para a memória. */
  static async load(db: Db): Promise<Store> {
    const store = new Store(db);
    const [users, spaces, roles, categories, channels, members, directs] = await Promise.all([
      db.user.findMany(),
      db.space.findMany(),
      db.role.findMany(),
      db.category.findMany(),
      db.channel.findMany({ include: { overwrites: true } }),
      db.member.findMany({ include: { roles: { select: { roleId: true } } } }),
      db.directConversation.findMany(),
    ]);
    for (const row of users) store.users.set(row.id, toUser(row));
    for (const row of spaces) store.spaces.set(row.id, toSpace(row));
    for (const row of roles) store.roles.set(row.id, toRole(row));
    for (const row of categories) store.categories.set(row.id, toCategory(row));
    for (const row of channels) store.channels.set(row.id, toChannel(row));
    for (const row of members) store.members.set(memberKey(row.spaceId, row.userId), toMember(row));
    for (const row of directs) store.directs.set(row.id, toDirect(row));
    return store;
  }

  // ── Usuários ───────────────────────────────────────────────────────────────

  /**
   * Autenticação provisória: o navegador gera um token aleatório e o guarda no
   * localStorage; o banco guarda só o hash. Substituir por login de verdade
   * (OAuth, senha + JWT) antes de produção.
   */
  async resolveSession(token: string, displayName: string): Promise<User> {
    const tokenHash = hashToken(token);
    const session = await this.db.session.findUnique({ where: { tokenHash } });
    const existing = session ? this.users.get(session.userId) : undefined;
    if (existing) {
      if (existing.displayName !== displayName) {
        await this.db.user.update({ where: { id: existing.id }, data: { displayName } });
        existing.displayName = displayName;
      }
      return existing;
    }

    const row = await this.db.user.create({
      data: {
        displayName,
        avatarColor: AVATAR_COLORS[this.users.size % AVATAR_COLORS.length],
        sessions: { create: { tokenHash } },
      },
    });
    const user = toUser(row);
    this.users.set(user.id, user);
    return user;
  }

  // ── Membros ────────────────────────────────────────────────────────────────

  async addMember(spaceId: Id, userId: Id): Promise<Member> {
    const row = await this.db.member.upsert({
      where: { spaceId_userId: { spaceId, userId } },
      create: { spaceId, userId },
      update: {},
      include: { roles: { select: { roleId: true } } },
    });
    const member = toMember(row);
    this.members.set(memberKey(spaceId, userId), member);
    return member;
  }

  member(spaceId: Id, userId: Id): Member | null {
    return this.members.get(memberKey(spaceId, userId)) ?? null;
  }

  spacesForUser(userId: Id): Space[] {
    return [...this.spaces.values()].filter((space) => this.members.has(memberKey(space.id, userId)));
  }

  sharesSpace(a: Id, b: Id): boolean {
    return this.spacesForUser(a).some((space) => this.members.has(memberKey(space.id, b)));
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

  // ── Conversas diretas ──────────────────────────────────────────────────────

  /** Devolve a conversa entre duas pessoas, criando-a na primeira vez. */
  async directBetween(a: Id, b: Id): Promise<DirectConversation> {
    const cached = [...this.directs.values()].find(
      ({ participantIds: [x, y] }) => (x === a && y === b) || (x === b && y === a),
    );
    if (cached) return cached;

    // O menor id fica em userAId: a restrição única impede o par duplicado.
    const [userAId, userBId] = [a, b].sort();
    const row = await this.db.directConversation.upsert({
      where: { userAId_userBId: { userAId, userBId } },
      create: { userAId, userBId },
      update: {},
    });
    const conversation = this.directs.get(row.id) ?? toDirect(row);
    this.directs.set(conversation.id, conversation);
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

  /**
   * Mensagens de um canal ou conversa em ordem cronológica. `before` pagina
   * para trás a partir de uma mensagem já conhecida.
   */
  async history(targetId: Id, before?: Id, limit = 50): Promise<Message[]> {
    const target = this.directs.has(targetId) ? { directId: targetId } : { channelId: targetId };
    const cursor = before
      ? await this.db.message.findUnique({ where: { id: before }, select: { id: true, createdAt: true } })
      : null;
    const rows = await this.db.message.findMany({
      where: {
        ...target,
        ...(cursor && {
          OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }],
        }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
    return rows.reverse().map(toMessage);
  }

  async addMessage(targetId: Id, authorId: Id, content: string): Promise<Message> {
    const createdAt = new Date();
    const direct = this.directs.get(targetId);
    if (!direct) {
      return toMessage(await this.db.message.create({ data: { channelId: targetId, authorId, content, createdAt } }));
    }

    const [row] = await this.db.$transaction([
      this.db.message.create({ data: { directId: targetId, authorId, content, createdAt } }),
      this.db.directConversation.update({ where: { id: targetId }, data: { lastMessageAt: createdAt } }),
    ]);
    direct.lastMessageAt = createdAt.toISOString();
    return toMessage(row);
  }

  // ── Voz ────────────────────────────────────────────────────────────────────

  voiceIn(channelId: Id): VoiceSession[] {
    return [...this.voice.values()].filter((v) => v.channelId === channelId);
  }
}

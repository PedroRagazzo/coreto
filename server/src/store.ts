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

import { randomUUID } from 'node:crypto';
import type {
  Category,
  Channel,
  ChannelKind,
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
import { DEFAULT_EVERYONE_PERMISSIONS } from '../../shared/src/permissions.js';
import { computeChannelPermissions, computeSpacePermissions } from './permissions.js';

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
    return computeChannelPermissions({ space, member, roles: this.rolesOf(space.id), channel });
  }

  /** Permissões no espaço, sem sobrescritas de canal; 0 para quem não é membro. */
  spacePermissionsFor(userId: Id, spaceId: Id): number {
    const space = this.spaces.get(spaceId);
    const member = this.member(spaceId, userId);
    if (!space || !member) return 0;
    return computeSpacePermissions({ space, member, roles: this.rolesOf(spaceId) });
  }

  private rolesOf(spaceId: Id): Role[] {
    return [...this.roles.values()].filter((r) => r.spaceId === spaceId);
  }

  // ── Criação de espaços e canais ────────────────────────────────────────────

  /**
   * Cria um espaço com o cargo @everyone, as categorias padrão, um canal de
   * texto e um de voz. Como todo espaço é público, todos os usuários viram membros.
   */
  async createSpace(name: string, ownerId: Id): Promise<Space> {
    const space: Space = { id: randomUUID(), name, ownerId, iconUrl: null };
    const everyone: Role = {
      id: space.id,
      spaceId: space.id,
      name: '@everyone',
      color: null,
      position: 0,
      permissions: DEFAULT_EVERYONE_PERMISSIONS,
      hoist: false,
    };
    const categories: Category[] = [
      { id: randomUUID(), spaceId: space.id, name: 'Canais de texto', position: 0 },
      { id: randomUUID(), spaceId: space.id, name: 'Canais de voz', position: 1 },
    ];
    const channels: Channel[] = [
      { id: randomUUID(), spaceId: space.id, categoryId: categories[0].id, name: 'geral', kind: 'text', position: 0, topic: null, overwrites: [] },
      { id: randomUUID(), spaceId: space.id, categoryId: categories[1].id, name: 'Geral', kind: 'voice', position: 0, topic: null, overwrites: [] },
    ];
    const joinedAt = new Date();
    const members: Member[] = [...this.users.keys()].map((userId) => ({
      spaceId: space.id,
      userId,
      nickname: null,
      roleIds: [],
      joinedAt: joinedAt.toISOString(),
    }));

    await this.db.$transaction([
      this.db.space.create({ data: { id: space.id, name, ownerId } }),
      this.db.role.create({
        data: { id: everyone.id, spaceId: space.id, name: everyone.name, position: 0, permissions: BigInt(everyone.permissions) },
      }),
      this.db.category.createMany({ data: categories }),
      this.db.channel.createMany({
        data: channels.map(({ overwrites: _none, kind, ...rest }) => ({ ...rest, kind: kind === 'text' ? 'TEXT' : 'VOICE' })),
      }),
      this.db.member.createMany({
        data: members.map(({ userId }) => ({ spaceId: space.id, userId, joinedAt })),
        skipDuplicates: true,
      }),
    ]);

    this.spaces.set(space.id, space);
    this.roles.set(everyone.id, everyone);
    for (const category of categories) this.categories.set(category.id, category);
    for (const channel of channels) this.channels.set(channel.id, channel);
    for (const member of members) this.members.set(memberKey(space.id, member.userId), member);
    return space;
  }

  categoryIn(spaceId: Id, categoryId: Id): Category | null {
    const category = this.categories.get(categoryId);
    return category?.spaceId === spaceId ? category : null;
  }

  /** Cria um canal no fim da categoria (ou da lista sem categoria), sem sobrescritas. */
  async createChannel(input: { spaceId: Id; categoryId: Id | null; name: string; kind: ChannelKind }): Promise<Channel> {
    const siblings = [...this.channels.values()].filter(
      (c) => c.spaceId === input.spaceId && c.categoryId === input.categoryId,
    );
    const position = siblings.reduce((max, c) => Math.max(max, c.position + 1), 0);
    const row = await this.db.channel.create({
      data: {
        spaceId: input.spaceId,
        categoryId: input.categoryId,
        name: input.name,
        kind: input.kind === 'text' ? 'TEXT' : 'VOICE',
        position,
      },
      include: { overwrites: true },
    });
    const channel = toChannel(row);
    this.channels.set(channel.id, channel);
    return channel;
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
      spacePermissions: this.spacePermissionsFor(userId, spaceId),
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

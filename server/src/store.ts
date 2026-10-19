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
  Attachment,
  Category,
  Channel,
  ChannelKind,
  DirectConversation,
  Id,
  Member,
  MentionCount,
  Message,
  Role,
  Space,
  SpaceSnapshot,
  User,
  VoiceParticipant,
} from '../../shared/src/models.js';
import type { MessageContext } from '../../shared/src/protocol.js';
import { hashToken, type Db } from './db/client.js';
import {
  messageInclude,
  toAttachment,
  toCategory,
  toChannel,
  toDirect,
  toMember,
  toMessage,
  toRole,
  toSpace,
  toUser,
} from './db/mappers.js';
import { loginKey, normalizeDisplayName } from '../../shared/src/names.js';
import { ALL_PERMISSIONS, DEFAULT_EVERYONE_PERMISSIONS } from '../../shared/src/permissions.js';
import { searchKey } from '../../shared/src/search.js';
import { hashPin, newSessionToken, verifyPin } from './auth.js';
import { computeChannelPermissions, computeSpacePermissions } from './permissions.js';

const AVATAR_COLORS = ['#2bb39a', '#5b8def', '#b07de0', '#e5a54b', '#e06c75', '#4fb3c8', '#8cbf5a'];

/** Sessão de voz de um usuário: no máximo uma por conta, presa ao socket que entrou. */
export interface VoiceSession extends VoiceParticipant {
  spaceId: Id;
  socketId: string;
}

export const toParticipant = ({
  userId,
  channelId,
  muted,
  deafened,
  video,
  streaming,
  watching,
}: VoiceSession): VoiceParticipant => ({ userId, channelId, muted, deafened, video, streaming, watching });

/** Um anexo do pedido não existe, é de outra pessoa ou já está em outra mensagem. */
export class AttachmentUnavailableError extends Error {
  constructor() {
    super('Anexo indisponível. Envie a imagem de novo.');
  }
}

export interface NewAttachment {
  uploaderId: Id;
  fileName: string;
  contentType: string;
  size: number;
  width: number;
  height: number;
}

/** Quem ganha e quem perde a menção de uma mensagem ao editá-la. */
export interface MentionChanges {
  channelId: Id;
  added: Id[];
  removed: Id[];
}

export type LoginResult =
  | { status: 'ok'; user: User; token: string; created: boolean }
  | { status: 'wrong_pin' }
  | { status: 'reserved_name' };

/** Posição de uma mensagem no histórico (o id desempata o mesmo milissegundo). */
type Cursor = { id: Id; createdAt: Date };

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

  /** Nomes de login (normalizados) com poder total em todos os espaços; vêm de SUPER_ADMIN_NAMES. */
  private superAdminKeys = new Set<string>();

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

  /** Dono do token de sessão, ou `null` se ele não existir. Sessões não expiram. */
  async userForSession(token: string): Promise<User | null> {
    const session = await this.db.session.findUnique({ where: { tokenHash: hashToken(token) } });
    return session ? (this.users.get(session.userId) ?? null) : null;
  }

  /**
   * Entra com nome e PIN e abre uma sessão nova. Se o nome estiver livre, cria
   * a conta com esse PIN. Espera nome e PIN já validados.
   */
  async login(name: string, pin: string): Promise<LoginResult> {
    const loginName = loginKey(name);
    const existing = await this.db.user.findUnique({ where: { loginName } });
    const token = newSessionToken();

    if (existing) {
      if (!existing.pinHash) return { status: 'reserved_name' };
      if (!(await verifyPin(pin, existing.pinHash))) return { status: 'wrong_pin' };
      await this.db.session.create({ data: { tokenHash: hashToken(token), userId: existing.id } });
      return { status: 'ok', user: this.users.get(existing.id) ?? toUser(existing), token, created: false };
    }

    try {
      const row = await this.db.user.create({
        data: {
          displayName: normalizeDisplayName(name),
          loginName,
          pinHash: await hashPin(pin),
          avatarColor: AVATAR_COLORS[this.users.size % AVATAR_COLORS.length],
          sessions: { create: { tokenHash: hashToken(token) } },
        },
      });
      const user = toUser(row);
      this.users.set(user.id, user);
      return { status: 'ok', user, token, created: true };
    } catch (err) {
      // Duas pessoas criando o mesmo nome ao mesmo tempo: quem perdeu tenta entrar na conta criada.
      if ((err as { code?: string }).code === 'P2002') return this.login(name, pin);
      throw err;
    }
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

  /** Define quem é administrador geral, pelo nome da conta (maiúsculas e acentos não importam). */
  setSuperAdmins(names: Iterable<string>): void {
    this.superAdminKeys = new Set([...names].map(loginKey));
  }

  /**
   * Administrador geral: tem todas as permissões em qualquer espaço, inclusive excluí-lo, mesmo sem
   * ser o dono. Vale pelo nome da conta, então a conta precisa existir e ter PIN.
   */
  isSuperAdmin(userId: Id): boolean {
    const user = this.users.get(userId);
    return user !== undefined && this.superAdminKeys.has(loginKey(user.displayName));
  }

  permissionsFor(userId: Id, channel: Channel): number {
    const space = this.spaces.get(channel.spaceId);
    const member = this.member(channel.spaceId, userId);
    if (!space || !member) return 0;
    if (this.isSuperAdmin(userId)) return ALL_PERMISSIONS;
    return computeChannelPermissions({ space, member, roles: this.rolesOf(space.id), channel });
  }

  /** Permissões no espaço, sem sobrescritas de canal; 0 para quem não é membro. */
  spacePermissionsFor(userId: Id, spaceId: Id): number {
    const space = this.spaces.get(spaceId);
    const member = this.member(spaceId, userId);
    if (!space || !member) return 0;
    if (this.isSuperAdmin(userId)) return ALL_PERMISSIONS;
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

  async updateSpace(spaceId: Id, name: string): Promise<Space> {
    const space = toSpace(await this.db.space.update({ where: { id: spaceId }, data: { name } }));
    this.spaces.set(space.id, space);
    return space;
  }

  /**
   * Apaga o espaço. O banco apaga em cascata cargos, categorias, canais (com
   * mensagens e sobrescritas) e membros; aqui a memória acompanha.
   */
  async deleteSpace(spaceId: Id): Promise<void> {
    await this.db.space.delete({ where: { id: spaceId } });
    this.spaces.delete(spaceId);
    for (const [id, role] of this.roles) if (role.spaceId === spaceId) this.roles.delete(id);
    for (const [id, category] of this.categories) if (category.spaceId === spaceId) this.categories.delete(id);
    for (const [id, channel] of this.channels) if (channel.spaceId === spaceId) this.channels.delete(id);
    for (const [key, member] of this.members) if (member.spaceId === spaceId) this.members.delete(key);
  }

  categoryIn(spaceId: Id, categoryId: Id): Category | null {
    const category = this.categories.get(categoryId);
    return category?.spaceId === spaceId ? category : null;
  }

  /** Posição logo depois do último canal da categoria (ou da lista sem categoria). */
  private nextChannelPosition(spaceId: Id, categoryId: Id | null): number {
    return [...this.channels.values()]
      .filter((c) => c.spaceId === spaceId && c.categoryId === categoryId)
      .reduce((max, c) => Math.max(max, c.position + 1), 0);
  }

  /** Cria um canal no fim da categoria (ou da lista sem categoria), sem sobrescritas. */
  async createChannel(input: { spaceId: Id; categoryId: Id | null; name: string; kind: ChannelKind }): Promise<Channel> {
    const row = await this.db.channel.create({
      data: {
        spaceId: input.spaceId,
        categoryId: input.categoryId,
        name: input.name,
        kind: input.kind === 'text' ? 'TEXT' : 'VOICE',
        position: this.nextChannelPosition(input.spaceId, input.categoryId),
      },
      include: { overwrites: true },
    });
    const channel = toChannel(row);
    this.channels.set(channel.id, channel);
    return channel;
  }

  /** Altera nome, tópico ou categoria. Ao mudar de categoria, o canal vai para o fim dela. */
  async updateChannel(
    channelId: Id,
    patch: { name?: string; topic?: string | null; categoryId?: Id | null },
  ): Promise<Channel> {
    const current = this.channels.get(channelId);
    if (!current) throw new Error(`Canal inexistente: ${channelId}`);
    const moving = patch.categoryId !== undefined && patch.categoryId !== current.categoryId;
    const row = await this.db.channel.update({
      where: { id: channelId },
      data: {
        ...patch,
        ...(moving && { position: this.nextChannelPosition(current.spaceId, patch.categoryId ?? null) }),
      },
      include: { overwrites: true },
    });
    const channel = toChannel(row);
    this.channels.set(channel.id, channel);
    return channel;
  }

  /** Apaga o canal; o banco apaga junto as mensagens e as sobrescritas dele. */
  async deleteChannel(channelId: Id): Promise<void> {
    await this.db.channel.delete({ where: { id: channelId } });
    this.channels.delete(channelId);
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
      canDelete: space.ownerId === userId || this.isSuperAdmin(userId),
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

  private targetWhere(targetId: Id) {
    return this.directs.has(targetId) ? { directId: targetId } : { channelId: targetId };
  }

  /** Antes (`older`) ou depois (`newer`) de uma posição, desempatando pelo id. */
  private static beyond(cursor: Cursor, direction: 'older' | 'newer') {
    const cmp = direction === 'older' ? 'lt' : 'gt';
    return { OR: [{ createdAt: { [cmp]: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { [cmp]: cursor.id } }] };
  }

  /** Até `take` mensagens a partir do cursor, em ordem cronológica. Sem cursor, as mais recentes. */
  private async page(targetId: Id, cursor: Cursor | null, direction: 'older' | 'newer', take: number) {
    const order = direction === 'older' ? 'desc' : 'asc';
    const rows = await this.db.message.findMany({
      where: { ...this.targetWhere(targetId), ...(cursor && Store.beyond(cursor, direction)) },
      orderBy: [{ createdAt: order }, { id: order }],
      take,
      include: messageInclude,
    });
    return (direction === 'older' ? rows.reverse() : rows).map(toMessage);
  }

  private async cursorOf(messageId: Id): Promise<Cursor | null> {
    return this.db.message.findUnique({ where: { id: messageId }, select: { id: true, createdAt: true } });
  }

  /**
   * Mensagens de um canal ou conversa em ordem cronológica: as mais recentes,
   * as anteriores a `before` ou as seguintes a `after`.
   */
  async history(targetId: Id, { before, after }: { before?: Id; after?: Id } = {}, limit = 50): Promise<Message[]> {
    if (after) {
      const cursor = await this.cursorOf(after);
      return cursor ? this.page(targetId, cursor, 'newer', limit) : [];
    }
    const cursor = before ? await this.cursorOf(before) : null;
    if (before && !cursor) return [];
    return this.page(targetId, cursor, 'older', limit);
  }

  /** A mensagem com até `size` vizinhas, metade de cada lado, e se o histórico acaba antes ou depois. */
  async context(message: Message, size = 50): Promise<Omit<MessageContext, 'channelId'>> {
    const cursor = { id: message.id, createdAt: new Date(message.createdAt) };
    const half = Math.floor(size / 2);
    // Uma a mais de cada lado só para saber se o histórico continua.
    const [older, newer] = await Promise.all([
      this.page(message.channelId, cursor, 'older', half + 1),
      this.page(message.channelId, cursor, 'newer', half + 1),
    ]);
    return {
      messages: [...older.slice(-half), message, ...newer.slice(0, half)],
      reachedStart: older.length <= half,
      reachedEnd: newer.length <= half,
    };
  }

  /**
   * Busca da mais recente para a mais antiga. Todas as palavras precisam
   * aparecer no texto normalizado (sem acentos, minúsculo).
   */
  async search(
    where: { channelIds?: Id[]; directId?: Id; words: string[]; authorId?: Id; has?: 'image' | 'link'; before?: Id },
    limit = 25,
  ): Promise<{ messages: Message[]; total: number }> {
    const filter = {
      ...(where.directId ? { directId: where.directId } : { channelId: { in: where.channelIds ?? [] } }),
      ...(where.authorId && { authorId: where.authorId }),
      ...(where.has === 'image' && { attachments: { some: {} } }),
      AND: [
        // O Prisma passa `contains` direto para o LIKE: sem escape, "%" e "_" seriam curingas.
        ...where.words.map((word) => ({ searchText: { contains: word.replace(/[\\%_]/g, '\\$&') } })),
        ...(where.has === 'link'
          ? [{ OR: [{ searchText: { contains: 'http://' } }, { searchText: { contains: 'https://' } }] }]
          : []),
      ],
    };
    const cursor = where.before ? await this.cursorOf(where.before) : null;
    const [total, rows] = await Promise.all([
      this.db.message.count({ where: filter }),
      this.db.message.findMany({
        where: { ...filter, ...(cursor && Store.beyond(cursor, 'older')) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
        include: messageInclude,
      }),
    ]);
    return { total, messages: rows.map(toMessage) };
  }

  /**
   * Horário estritamente crescente para mensagens. O banco guarda milissegundos;
   * duas mensagens no mesmo milissegundo empatariam e o desempate pelo id (UUID
   * aleatório) poderia inverter a ordem no histórico.
   */
  private nextMessageTime(): Date {
    this.lastMessageTime = Math.max(Date.now(), this.lastMessageTime + 1);
    return new Date(this.lastMessageTime);
  }
  private lastMessageTime = 0;

  /**
   * Grava a mensagem com os anexos (já enviados por `authorId` e ainda soltos)
   * e as menções de canal, tudo ou nada.
   */
  async addMessage(
    targetId: Id,
    authorId: Id,
    content: string,
    { attachmentIds = [], mentions = [] }: { attachmentIds?: Id[]; mentions?: Id[] } = {},
  ): Promise<Message> {
    const createdAt = this.nextMessageTime();
    const direct = this.directs.get(targetId);
    const row = await this.db.$transaction(async (tx) => {
      const message = await tx.message.create({
        data: {
          ...(direct ? { directId: targetId } : { channelId: targetId }),
          authorId,
          content,
          searchText: searchKey(content),
          createdAt,
        },
      });
      for (const [position, id] of attachmentIds.entries()) {
        const { count } = await tx.attachment.updateMany({
          where: { id, uploaderId: authorId, messageId: null },
          data: { messageId: message.id, position },
        });
        if (count !== 1) throw new AttachmentUnavailableError();
      }
      if (mentions.length > 0) {
        await tx.mention.createMany({ data: mentions.map((userId) => ({ messageId: message.id, userId, channelId: targetId })) });
      }
      if (direct) await tx.directConversation.update({ where: { id: targetId }, data: { lastMessageAt: createdAt } });
      return tx.message.findUniqueOrThrow({ where: { id: message.id }, include: messageInclude });
    });
    if (direct) direct.lastMessageAt = createdAt.toISOString();
    return toMessage(row);
  }

  async findMessage(messageId: Id): Promise<Message | null> {
    const row = await this.db.message.findUnique({ where: { id: messageId }, include: messageInclude });
    return row ? toMessage(row) : null;
  }

  async editMessage(messageId: Id, content: string, mentions?: MentionChanges): Promise<Message> {
    const [row] = await this.db.$transaction([
      this.db.message.update({
        where: { id: messageId },
        data: { content, searchText: searchKey(content), editedAt: new Date() },
        include: messageInclude,
      }),
      this.db.mention.deleteMany({ where: { messageId, userId: { in: mentions?.removed ?? [] } } }),
      this.db.mention.createMany({
        data: (mentions?.added ?? []).map((userId) => ({ messageId, userId, channelId: mentions!.channelId })),
        skipDuplicates: true,
      }),
    ]);
    return toMessage(row);
  }

  /** Apaga a mensagem; anexos e menções vão junto (os arquivos dos anexos ficam com quem chamou). */
  async deleteMessage(messageId: Id): Promise<void> {
    await this.db.message.delete({ where: { id: messageId } });
  }

  // ── Anexos ─────────────────────────────────────────────────────────────────

  /** Registra um anexo ainda solto (sem mensagem). Grave o arquivo depois disso. */
  async createAttachment(input: NewAttachment): Promise<Attachment> {
    return toAttachment(await this.db.attachment.create({ data: input }));
  }

  async discardAttachment(id: Id): Promise<void> {
    await this.db.attachment.deleteMany({ where: { id } });
  }

  /** Anexo já publicado numa mensagem; os soltos não são servidos. */
  async publishedAttachment(id: Id): Promise<Attachment | null> {
    const row = await this.db.attachment.findFirst({ where: { id, messageId: { not: null } } });
    return row ? toAttachment(row) : null;
  }

  // ── Menções ────────────────────────────────────────────────────────────────

  /** Menções não vistas do usuário, por canal. */
  async mentionCounts(userId: Id): Promise<MentionCount[]> {
    const groups = await this.db.mention.groupBy({ by: ['channelId'], where: { userId }, _count: { _all: true } });
    return groups.flatMap(({ channelId, _count }) => {
      const channel = this.channels.get(channelId);
      return channel ? [{ channelId, spaceId: channel.spaceId, count: _count._all }] : [];
    });
  }

  async mentionCount(userId: Id, channelId: Id): Promise<number> {
    return this.db.mention.count({ where: { userId, channelId } });
  }

  /** Quem tem menção não vista nesta mensagem. */
  async mentionedIn(messageId: Id): Promise<Id[]> {
    const rows = await this.db.mention.findMany({ where: { messageId }, select: { userId: true } });
    return rows.map((r) => r.userId);
  }

  /** Quem tem menção não vista neste canal. */
  async mentionedInChannel(channelId: Id): Promise<Id[]> {
    const rows = await this.db.mention.findMany({ where: { channelId }, distinct: ['userId'], select: { userId: true } });
    return rows.map((r) => r.userId);
  }

  async clearMentions(userId: Id, channelId: Id): Promise<void> {
    await this.db.mention.deleteMany({ where: { userId, channelId } });
  }

  // ── Voz ────────────────────────────────────────────────────────────────────

  voiceIn(channelId: Id): VoiceSession[] {
    return [...this.voice.values()].filter((v) => v.channelId === channelId);
  }
}

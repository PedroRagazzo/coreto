// Modelos de domínio compartilhados entre servidor e cliente.

export type Id = string;

export type PresenceStatus = 'online' | 'idle' | 'dnd' | 'offline';

export interface User {
  id: Id;
  displayName: string;
  avatarColor: string;
  status: PresenceStatus;
  isBot: boolean;
}

/** Uma comunidade: agrupa cargos, categorias, canais e membros. */
export interface Space {
  id: Id;
  name: string;
  ownerId: Id;
  iconUrl: string | null;
}

export interface Category {
  id: Id;
  spaceId: Id;
  name: string;
  position: number;
}

export type ChannelKind = 'text' | 'voice';

export type OverwriteTarget = 'role' | 'member';

/** Ajuste de permissões de um canal para um cargo ou membro específico. */
export interface PermissionOverwrite {
  targetType: OverwriteTarget;
  targetId: Id;
  allow: number;
  deny: number;
}

export interface Channel {
  id: Id;
  spaceId: Id;
  categoryId: Id | null;
  name: string;
  kind: ChannelKind;
  position: number;
  topic: string | null;
  overwrites: PermissionOverwrite[];
}

/**
 * Cargo dentro de um espaço. Convenção: o cargo "@everyone" tem o mesmo id do
 * espaço e vale para todos os membros.
 */
export interface Role {
  id: Id;
  spaceId: Id;
  name: string;
  color: string | null;
  position: number;
  permissions: number;
  hoist: boolean;
}

export interface Member {
  spaceId: Id;
  userId: Id;
  nickname: string | null;
  roleIds: Id[];
  joinedAt: string;
}

/**
 * Conversa privada entre duas pessoas que participam de pelo menos um espaço em comum.
 * As mensagens dela usam o id da conversa como `Message.channelId`.
 */
export interface DirectConversation {
  id: Id;
  participantIds: [Id, Id];
  lastMessageAt: string | null;
}

/** Imagem anexada a uma mensagem. O arquivo é servido em `GET /uploads/<id>`. */
export interface Attachment {
  id: Id;
  fileName: string;
  contentType: string;
  /** Bytes. */
  size: number;
  width: number;
  height: number;
}

export interface Message {
  id: Id;
  /** Id de um canal de texto ou de uma conversa direta. */
  channelId: Id;
  authorId: Id;
  /** Texto com a formatação de markup.ts; menções como `<@id>`. Pode ser vazio se houver anexos. */
  content: string;
  attachments: Attachment[];
  createdAt: string;
  editedAt: string | null;
}

/** Menções ainda não vistas de um usuário num canal. */
export interface MentionCount {
  channelId: Id;
  spaceId: Id;
  count: number;
}

export interface VoiceParticipant {
  userId: Id;
  channelId: Id;
  muted: boolean;
  deafened: boolean;
  /** Câmera ligada. */
  video: boolean;
  /** Está compartilhando a tela ("ao vivo"). */
  streaming: boolean;
  /** O que está sendo compartilhado ("Tela 1", o nome da janela); `null` fora da transmissão. */
  streamTitle: string | null;
  /** O que a pessoa está fazendo na sala, hoje só o que o bot de música está tocando; `null` quando nada. */
  activity: string | null;
  /** De quem está assistindo a transmissão, na mesma sala (pode ser mais de uma, até `MAX_WATCHED_STREAMS`). */
  watching: Id[];
}

/** Quantas transmissões a mesma pessoa assiste ao mesmo tempo (cada uma é um vídeo a mais para receber e decodificar). */
export const MAX_WATCHED_STREAMS = 4;

/** Tudo que o cliente precisa para desenhar um espaço ao entrar nele. */
export interface SpaceSnapshot {
  space: Space;
  categories: Category[];
  /** Somente os canais que o usuário pode ver. */
  channels: Channel[];
  roles: Role[];
  members: Member[];
  users: User[];
  voice: VoiceParticipant[];
  /** Permissões efetivas do usuário, por id de canal. */
  permissions: Record<Id, number>;
  /** Permissões do usuário no espaço, antes das sobrescritas de canal (ex.: MANAGE_CHANNELS). */
  spacePermissions: number;
  /** Pode excluir o espaço: é o dono ou administrador geral. */
  canDelete: boolean;
}

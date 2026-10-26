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

/**
 * Anexo de uma mensagem: uma imagem (que aparece na conversa) ou outro arquivo (que se baixa). O conteúdo é servido em
 * `GET /uploads/<id>`.
 */
export interface Attachment {
  id: Id;
  fileName: string;
  /** Das imagens, o tipo lido do conteúdo; dos outros arquivos, sempre `application/octet-stream`. */
  contentType: string;
  /** Bytes. */
  size: number;
  /** Dimensões da imagem; `null` quando o anexo é um arquivo. */
  width: number | null;
  height: number | null;
}

/** Um som do quadro de som de um espaço. O áudio é servido em `GET /sounds/<id>`. */
export interface SoundClip {
  id: Id;
  spaceId: Id;
  name: string;
  /** Um emoji para identificar o som no quadro; `null` se não tem. */
  emoji: string | null;
  /** Quem enviou (e pode remover). */
  uploaderId: Id;
  /** Formato do áudio, lido do conteúdo (ex.: `audio/mpeg`). */
  contentType: string;
  size: number;
  createdAt: string;
}

/** Um anexo que é uma imagem (aparece na conversa), com as dimensões. */
export type ImageAttachment = Attachment & { width: number; height: number };

/** O anexo é uma imagem (aparece na conversa) e não um arquivo para baixar? */
export const isImageAttachment = (a: Attachment): a is ImageAttachment => a.width !== null && a.height !== null;

/** Uma opção de enquete e quem votou nela. */
export interface PollOption {
  id: Id;
  text: string;
  /** Quem votou, na ordem dos votos. */
  userIds: Id[];
}

/** A enquete de uma mensagem. A pergunta é o texto (`content`) da própria mensagem. */
export interface Poll {
  /** Cada pessoa pode votar em mais de uma opção. */
  multiple: boolean;
  /** Encerrada: não aceita mais votos. */
  closed: boolean;
  options: PollOption[];
}

/** A roleta de uma mensagem: as opções e, depois que alguém gira, a sorteada. O título é o texto da mensagem. */
export interface Roulette {
  options: string[];
  /** Posição da opção sorteada em `options`; `null` enquanto ninguém girou. */
  result: number | null;
  spunAt: string | null;
  spunById: Id | null;
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
  /** A mensagem a que esta responde; `null` se não é uma resposta. */
  replyTo: ReplyPreview | null;
  /** Reações, na ordem em que cada emoji apareceu pela primeira vez. */
  reactions: Reaction[];
  /** Quando a mensagem foi fixada no canal ou na conversa; `null` se não está fixada. */
  pinnedAt: string | null;
  /** Quem a fixou; `null` se não está fixada. */
  pinnedById: Id | null;
  /** Presente quando a mensagem é uma enquete (o `content` é a pergunta). */
  poll: Poll | null;
  /** Presente quando a mensagem é uma roleta (o `content` é o título, ou "Roleta"). */
  roulette: Roulette | null;
}

/** O cartão de pré-visualização de um link (título, descrição e imagem da página, ou a própria imagem do link). */
export interface LinkPreview {
  url: string;
  /** `page`: uma página com título e talvez imagem; `image`: o link é uma imagem (ou GIF) e aparece como ela. */
  kind: 'page' | 'image';
  title: string | null;
  description: string | null;
  siteName: string | null;
  /** A imagem, entregue pelo servidor em /embed-image/<id> (o navegador nunca visita o site de origem). */
  image: { id: string; width: number | null; height: number | null } | null;
}

/** O que se mostra da mensagem respondida, acima da resposta. */
export interface ReplyPreview {
  id: Id;
  /** A original foi apagada (ou não existe mais). */
  deleted: boolean;
  /** `null` quando a original foi apagada. */
  authorId: Id | null;
  /** Começo do texto da original (sem quebras de linha); vazio se ela só tinha imagens ou foi apagada. */
  excerpt: string;
  /** A original tinha imagens. */
  hasAttachments: boolean;
}

/** Quem reagiu a uma mensagem com um emoji. */
export interface Reaction {
  emoji: string;
  userIds: Id[];
}

/** Mensagens de outras pessoas ainda não lidas num canal (ou, com `spaceId` nulo, numa conversa direta). */
export interface UnreadCount {
  channelId: Id;
  spaceId: Id | null;
  count: number;
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

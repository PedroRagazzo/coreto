// Contrato dos eventos socket.io. Servidor e cliente tipam o socket com estas interfaces.

import type {
  Attachment,
  Channel,
  ChannelKind,
  DirectConversation,
  Id,
  Member,
  MentionCount,
  Message,
  PresenceStatus,
  Reaction,
  Space,
  UnreadCount,
  SpaceSnapshot,
  User,
  VoiceParticipant,
} from './models.js';

export type Ack<T> = { ok: true; data: T } | { ok: false; error: string };

export const MAX_MESSAGE_LENGTH = 2000;
/** Mensagens por página do histórico; uma página menor que isso significa que chegou ao começo. */
export const HISTORY_PAGE_SIZE = 50;

// ── Anexos (HTTP POST /uploads) ──────────────────────────────────────────────
// O corpo é o arquivo cru; `Authorization: Bearer <token>` e `X-File-Name`
// (codificado com encodeURIComponent). Depois, o id vai em `message:send`.

export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_MESSAGE = 4;
export const ATTACHMENT_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;

export type UploadResponse = { ok: true; attachment: Attachment } | { ok: false; error: string };

// ── Login (HTTP POST /login) ─────────────────────────────────────────────────
// O socket.io só aceita conexões com o token de sessão devolvido aqui.

export interface LoginRequest {
  name: string;
  /** Exatamente 4 dígitos. */
  pin: string;
}

export type LoginErrorCode = 'invalid_input' | 'wrong_pin' | 'reserved_name' | 'locked';

export type LoginResponse =
  | { ok: true; token: string; user: User; created: boolean }
  | { ok: false; code: LoginErrorCode; error: string };

/** Código em `err.data.code` quando o socket.io recusa a conexão. */
export const INVALID_SESSION = 'invalid_session';

export type SelectableStatus = Exclude<PresenceStatus, 'offline'>;

// Formatos serializáveis de WebRTC, sem depender da lib DOM no servidor.
export interface SessionDescription {
  type: 'offer' | 'answer';
  sdp: string;
}

export interface IceCandidate {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export type SignalPayload =
  | { kind: 'description'; description: SessionDescription }
  | { kind: 'candidate'; candidate: IceCandidate }
  /**
   * Ids dos fluxos de câmera e de tela de quem envia, mandados ao abrir a
   * conexão: é assim que quem recebe distingue um vídeo do outro.
   */
  | { kind: 'media'; camera: string; screen: string };

/** Uma música da fila do bot de música. */
export interface MusicTrackInfo {
  /** Identifica a música na fila (para tirá-la de lá). */
  id: string;
  title: string;
  artist: string | null;
  /** Em segundos; `null` quando não se sabe. */
  durationSeconds: number | null;
  /** Nome de quem pediu. */
  requestedBy: string;
}

/** O que o bot de música está fazendo na sala de voz; chega a quem está nela. */
export interface MusicState {
  channelId: Id;
  /** A que está tocando, com o ponto em que está; `null` com a fila parada. */
  current: (MusicTrackInfo & { positionMs: number }) | null;
  paused: boolean;
  /** 0 a 150; 100 é o volume normal. */
  volume: number;
  queue: MusicTrackInfo[];
  /** Último problema ao tocar (ex.: vídeo privado); some quando a próxima música começa. */
  notice: string | null;
}

export type MusicControl =
  | { action: 'skip' | 'pause' | 'resume' | 'stop' | 'clear' | 'shuffle' }
  | { action: 'remove' | 'top'; id: string }
  | { action: 'volume'; volume: number };

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface VoiceJoinResult {
  /** Quem já estava na sala; quem entra inicia a negociação com cada um. */
  peers: Id[];
  iceServers: IceServer[];
  /** `relay` força o áudio a passar pelo TURN (útil para testar o TURN). */
  iceTransportPolicy: 'all' | 'relay';
  /** O servidor tem um servidor de mídia (SFU) para as transmissões de tela; sem ele, a tela vai pela malha P2P. */
  sfu: boolean;
}

/** Acesso à sala do servidor de mídia (LiveKit) da chamada em que você está. */
export interface SfuAccess {
  /** Endereço wss:// do servidor de mídia. */
  url: string;
  token: string;
}

/** Onde buscar: todos os canais de texto que você vê num espaço, ou uma conversa direta. */
export type SearchScope = { spaceId: Id } | { directId: Id };

export interface SearchRequest {
  scope: SearchScope;
  /** Palavras que precisam aparecer (todas), sem diferenciar acentos nem maiúsculas. */
  text?: string;
  authorId?: Id;
  /** Só com `scope.spaceId`: limita a um canal. */
  channelId?: Id;
  has?: 'image' | 'link';
  /** Próxima página: resultados mais antigos que esta mensagem. */
  before?: Id;
}

export interface SearchResult {
  /** Da mais recente para a mais antiga. */
  messages: Message[];
  /** Total de resultados (todas as páginas). */
  total: number;
}

/** Mensagens em volta de uma, para pular até ela (resultado de busca). */
export interface MessageContext {
  channelId: Id;
  /** Em ordem cronológica, com a mensagem pedida no meio. */
  messages: Message[];
  /** Não há nada antes / depois do que veio. */
  reachedStart: boolean;
  reachedEnd: boolean;
}

export interface DirectConversationPayload {
  conversation: DirectConversation;
  /** Os dois participantes, para o cliente conhecer nome, cor e status. */
  users: User[];
}

export interface ChannelCreatedPayload {
  channel: Channel;
  /** Permissões efetivas de quem recebe o evento no canal novo. */
  permissions: number;
}

export interface CreateChannelRequest {
  spaceId: Id;
  categoryId: Id | null;
  name: string;
  kind: ChannelKind;
}

/** Só os campos presentes são alterados. O tópico vale só para canais de texto. */
export interface UpdateChannelRequest {
  channelId: Id;
  name?: string;
  topic?: string | null;
  categoryId?: Id | null;
}

// `channelId` em history/send/typing aceita um canal de texto ou uma conversa direta.
export interface ClientToServerEvents {
  'space:join': (spaceId: Id, ack: (res: Ack<SpaceSnapshot>) => void) => void;
  'space:create': (req: { name: string }, ack: (res: Ack<Space>) => void) => void;
  /** Renomeia o espaço; exige ADMINISTRATOR (o dono tem). */
  'space:update': (req: { spaceId: Id; name: string }, ack: (res: Ack<Space>) => void) => void;
  /** Apaga o espaço com tudo dentro; só o dono. */
  'space:delete': (req: { spaceId: Id }, ack: (res: Ack<null>) => void) => void;
  'channel:create': (req: CreateChannelRequest, ack: (res: Ack<ChannelCreatedPayload>) => void) => void;
  'channel:update': (req: UpdateChannelRequest, ack: (res: Ack<Channel>) => void) => void;
  /** Apaga o canal e todas as mensagens dele. */
  'channel:delete': (req: { channelId: Id }, ack: (res: Ack<null>) => void) => void;
  'dm:open': (req: { userId: Id }, ack: (res: Ack<DirectConversationPayload>) => void) => void;
  /**
   * Página do histórico em ordem cronológica: sem cursor, as mais recentes;
   * `before`, as anteriores a uma mensagem; `after`, as seguintes.
   */
  'channel:history': (
    req: { channelId: Id; before?: Id; after?: Id; limit?: number },
    ack: (res: Ack<Message[]>) => void,
  ) => void;
  /** A mensagem com as vizinhas, onde quer que esteja no histórico. */
  'message:context': (req: { messageId: Id }, ack: (res: Ack<MessageContext>) => void) => void;
  'message:search': (req: SearchRequest, ack: (res: Ack<SearchResult>) => void) => void;
  /** `attachmentIds`: anexos enviados antes por POST /uploads, na ordem em que aparecem. */
  'message:send': (
    req: { channelId: Id; content: string; attachmentIds?: Id[]; replyToId?: Id },
    ack: (res: Ack<Message>) => void,
  ) => void;
  /** Reage à mensagem com um emoji, ou tira a reação se já tinha reagido com ele. */
  'reaction:toggle': (req: { messageId: Id; emoji: string }, ack: (res: Ack<null>) => void) => void;
  /** Só o autor edita; os anexos não mudam. */
  'message:edit': (req: { messageId: Id; content: string }, ack: (res: Ack<Message>) => void) => void;
  /** O autor apaga; em canais, quem tem MANAGE_MESSAGES também. */
  'message:delete': (req: { messageId: Id }, ack: (res: Ack<null>) => void) => void;
  'typing:start': (req: { channelId: Id }) => void;
  /** O usuário viu o canal: zera as menções dele ali. */
  'mentions:ack': (req: { channelId: Id }) => void;
  'presence:set': (status: SelectableStatus) => void;
  /** A pessoa leu este canal ou conversa até agora: zera as mensagens não lidas dele. */
  'read:mark': (req: { channelId: Id }) => void;
  'voice:join': (req: { channelId: Id }, ack: (res: Ack<VoiceJoinResult>) => void) => void;
  'voice:leave': () => void;
  'voice:state': (req: { muted: boolean; deafened: boolean }) => void;
  /** Liga ou desliga a câmera na sala em que está; ligar exige STREAM. */
  'voice:video': (req: { enabled: boolean }, ack: (res: Ack<null>) => void) => void;
  'voice:signal': (req: { to: Id; signal: SignalPayload }) => void;
  /** Começa a compartilhar a tela na sala em que está; exige STREAM. `title` é o que está sendo compartilhado. */
  'stream:start': (req: { title: string }, ack: (res: Ack<null>) => void) => void;
  'stream:stop': () => void;
  /** Token para entrar na sala do servidor de mídia da chamada; quem tem STREAM pode enviar vídeo, os outros só recebem. */
  'sfu:token': (ack: (res: Ack<SfuAccess>) => void) => void;
  /** Quem transmite manda, de tempos em tempos, uma miniatura da tela (JPEG em data URL) para a prévia da lista. */
  'stream:preview': (req: { image: string }) => void;
  /** A miniatura mais recente da transmissão de alguém da sala; `null` se ainda não chegou nenhuma. */
  'stream:preview:get': (req: { userId: Id }, ack: (res: Ack<{ image: string | null }>) => void) => void;
  /** Pede uma música ao bot (link do YouTube/Spotify ou busca); com `next`, ela vai para a frente da fila. A resposta traz o aviso. */
  'music:play': (req: { input: string; next?: boolean }, ack: (res: Ack<{ message: string }>) => void) => void;
  /** Controla o bot de música; só quem está na mesma sala de voz que ele. */
  'music:control': (req: MusicControl, ack: (res: Ack<null>) => void) => void;
  /** Assiste à transmissão de alguém da mesma sala (até `MAX_WATCHED_STREAMS` ao mesmo tempo). */
  'stream:watch':(req: { userId: Id }, ack: (res: Ack<null>) => void) => void;
  /** Para de assistir à transmissão de `userId`; sem ele, a todas. */
  'stream:unwatch': (req?: { userId?: Id }) => void;
}

export interface ServerToClientEvents {
  'session:ready': (payload: {
    user: User;
    spaces: Space[];
    directs: DirectConversation[];
    /** Quem está do outro lado das conversas diretas. */
    directUsers: User[];
    /** Menções ainda não vistas, por canal (de todos os espaços). */
    mentions: MentionCount[];
    /** Mensagens não lidas por canal e conversa (de todos os espaços); o que não está na lista tem zero. */
    unread: UnreadCount[];
  }) => void;
  /** Um espaço novo foi criado; todos os usuários já são membros dele. */
  'space:created': (space: Space) => void;
  'space:updated': (space: Space) => void;
  'space:deleted': (payload: { spaceId: Id }) => void;
  /** Um canal novo apareceu no espaço aberto; só chega para quem pode vê-lo. */
  'channel:created': (payload: ChannelCreatedPayload) => void;
  /** Nome, tópico ou categoria mudaram; só chega para quem pode ver o canal. */
  'channel:updated': (channel: Channel) => void;
  'channel:deleted': (payload: { spaceId: Id; channelId: Id }) => void;
  /** Uma conversa direta foi criada ou recebeu mensagem. Chega antes do `message:new`. */
  'dm:upsert': (payload: DirectConversationPayload) => void;
  'message:new': (message: Message) => void;
  'message:updated': (message: Message) => void;
  /** Chegou uma mensagem de outra pessoa num lugar que você lê: mais uma não lida (ou lida, se você está olhando). */
  'unread:bump': (payload: { channelId: Id; spaceId: Id | null }) => void;
  /** As reações de uma mensagem mudaram (a lista inteira, já atualizada). */
  'message:reactions': (payload: { channelId: Id; messageId: Id; reactions: Reaction[] }) => void;
  'message:deleted': (payload: { channelId: Id; messageId: Id }) => void;
  typing: (payload: { channelId: Id; userId: Id }) => void;
  /** O número de menções não vistas do usuário num canal mudou (0 = todas vistas). */
  'mentions:update': (payload: MentionCount) => void;
  'presence:update': (payload: { userId: Id; status: PresenceStatus }) => void;
  'member:joined': (payload: { member: Member; user: User }) => void;
  'voice:update': (payload: { channelId: Id; participants: VoiceParticipant[] }) => void;
  'voice:peer-left': (payload: { userId: Id }) => void;
  'voice:signal': (payload: { from: Id; signal: SignalPayload }) => void;
  'voice:ended': (payload: { reason: string }) => void;
  /** O estado do bot de música na sala em que você está; `null` quando ele saiu da chamada. */
  'music:state': (state: MusicState | null) => void;
}

export interface SocketData {
  userId: Id;
}

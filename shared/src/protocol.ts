// Contrato dos eventos socket.io. Servidor e cliente tipam o socket com estas interfaces.

import type {
  Channel,
  ChannelKind,
  DirectConversation,
  Id,
  Member,
  Message,
  PresenceStatus,
  Space,
  SpaceSnapshot,
  User,
  VoiceParticipant,
} from './models.js';

export type Ack<T> = { ok: true; data: T } | { ok: false; error: string };

export const MAX_MESSAGE_LENGTH = 2000;
/** Mensagens por página do histórico; uma página menor que isso significa que chegou ao começo. */
export const HISTORY_PAGE_SIZE = 50;

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
  | { kind: 'candidate'; candidate: IceCandidate };

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface VoiceJoinResult {
  /** Quem já estava na sala; quem entra inicia a negociação com cada um. */
  peers: Id[];
  iceServers: IceServer[];
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
  'channel:history': (
    req: { channelId: Id; before?: Id; limit?: number },
    ack: (res: Ack<Message[]>) => void,
  ) => void;
  'message:send': (req: { channelId: Id; content: string }, ack: (res: Ack<Message>) => void) => void;
  /** Só o autor edita. */
  'message:edit': (req: { messageId: Id; content: string }, ack: (res: Ack<Message>) => void) => void;
  /** O autor apaga; em canais, quem tem MANAGE_MESSAGES também. */
  'message:delete': (req: { messageId: Id }, ack: (res: Ack<null>) => void) => void;
  'typing:start': (req: { channelId: Id }) => void;
  'presence:set': (status: SelectableStatus) => void;
  'voice:join': (req: { channelId: Id }, ack: (res: Ack<VoiceJoinResult>) => void) => void;
  'voice:leave': () => void;
  'voice:state': (req: { muted: boolean; deafened: boolean }) => void;
  'voice:signal': (req: { to: Id; signal: SignalPayload }) => void;
}

export interface ServerToClientEvents {
  'session:ready': (payload: {
    user: User;
    spaces: Space[];
    directs: DirectConversation[];
    /** Quem está do outro lado das conversas diretas. */
    directUsers: User[];
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
  'message:deleted': (payload: { channelId: Id; messageId: Id }) => void;
  typing: (payload: { channelId: Id; userId: Id }) => void;
  'presence:update': (payload: { userId: Id; status: PresenceStatus }) => void;
  'member:joined': (payload: { member: Member; user: User }) => void;
  'voice:update': (payload: { channelId: Id; participants: VoiceParticipant[] }) => void;
  'voice:peer-left': (payload: { userId: Id }) => void;
  'voice:signal': (payload: { from: Id; signal: SignalPayload }) => void;
  'voice:ended': (payload: { reason: string }) => void;
}

export interface SocketData {
  userId: Id;
}

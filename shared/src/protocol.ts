// Contrato dos eventos socket.io. Servidor e cliente tipam o socket com estas interfaces.

import type {
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

// `channelId` em history/send/typing aceita um canal de texto ou uma conversa direta.
export interface ClientToServerEvents {
  'space:join': (spaceId: Id, ack: (res: Ack<SpaceSnapshot>) => void) => void;
  'dm:open': (req: { userId: Id }, ack: (res: Ack<DirectConversationPayload>) => void) => void;
  'channel:history': (
    req: { channelId: Id; before?: Id; limit?: number },
    ack: (res: Ack<Message[]>) => void,
  ) => void;
  'message:send': (req: { channelId: Id; content: string }, ack: (res: Ack<Message>) => void) => void;
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
  /** Uma conversa direta foi criada ou recebeu mensagem. Chega antes do `message:new`. */
  'dm:upsert': (payload: DirectConversationPayload) => void;
  'message:new': (message: Message) => void;
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

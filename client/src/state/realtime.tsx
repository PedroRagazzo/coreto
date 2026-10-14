// Estado global em tempo real: um socket por sessão, eventos do servidor
// viram ações do reducer, e os componentes chamam `actions` para agir.

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
} from '@shared/models';
import { hasPermission, Permission } from '@shared/permissions';
import type {
  ChannelCreatedPayload,
  CreateChannelRequest,
  DirectConversationPayload,
  SelectableStatus,
} from '@shared/protocol';
import { createContext, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';
import type { Identity } from '../lib/identity';
import { createSocket, type AppSocket } from '../lib/socket';
import { describeMediaError, VoiceManager } from '../lib/voice';

const TYPING_TTL_MS = 6_000;
const TYPING_THROTTLE_MS = 3_000;

export interface MyVoiceState {
  channelId: Id | null;
  channelName: string | null;
  spaceName: string | null;
  connecting: boolean;
  muted: boolean;
  deafened: boolean;
  canSpeak: boolean;
  error: string | null;
}

export interface RealtimeState {
  connection: 'connecting' | 'ready' | 'disconnected';
  connectionError: string | null;
  me: User | null;
  spaces: Space[];
  /** `null` = área de mensagens diretas. */
  activeSpaceId: Id | null;
  activeChannelBySpace: Record<Id, Id>;
  snapshot: SpaceSnapshot | null;
  directs: Record<Id, DirectConversation>;
  activeDirectId: Id | null;
  /** conversa direta → mensagens recebidas e ainda não vistas */
  unread: Record<Id, number>;
  users: Record<Id, User>;
  /** canal de texto ou conversa direta → mensagens */
  messages: Record<Id, Message[]>;
  /** canal ou conversa → usuário → instante (ms) em que o aviso de digitação expira */
  typing: Record<Id, Record<Id, number>>;
  voice: Record<Id, VoiceParticipant[]>;
  myVoice: MyVoiceState;
}

const IDLE_VOICE: MyVoiceState = {
  channelId: null,
  channelName: null,
  spaceName: null,
  connecting: false,
  muted: false,
  deafened: false,
  canSpeak: true,
  error: null,
};

const initialState: RealtimeState = {
  connection: 'connecting',
  connectionError: null,
  me: null,
  spaces: [],
  activeSpaceId: null,
  activeChannelBySpace: {},
  snapshot: null,
  directs: {},
  activeDirectId: null,
  unread: {},
  users: {},
  messages: {},
  typing: {},
  voice: {},
  myVoice: IDLE_VOICE,
};

type Action =
  | { type: 'connection'; connection: RealtimeState['connection']; error?: string }
  | { type: 'session'; user: User; spaces: Space[]; directs: DirectConversation[]; directUsers: User[] }
  | { type: 'space:created'; space: Space }
  | { type: 'channel:created'; payload: ChannelCreatedPayload }
  | { type: 'dm:upsert'; payload: DirectConversationPayload }
  | { type: 'dm:select'; conversationId: Id }
  | { type: 'space:select'; spaceId: Id | null }
  | { type: 'space:snapshot'; snapshot: SpaceSnapshot }
  | { type: 'channel:select'; spaceId: Id; channelId: Id }
  | { type: 'messages:history'; channelId: Id; messages: Message[] }
  | { type: 'message:new'; message: Message }
  | { type: 'typing'; channelId: Id; userId: Id; until: number }
  | { type: 'presence'; userId: Id; status: PresenceStatus }
  | { type: 'member:joined'; member: Member; user: User }
  | { type: 'voice:update'; channelId: Id; participants: VoiceParticipant[] }
  | { type: 'voice:self'; patch: Partial<MyVoiceState> };

function withoutKey<T>(record: Record<Id, T> | undefined, key: Id): Record<Id, T> {
  const { [key]: _removed, ...rest } = record ?? {};
  return rest;
}

function reducer(state: RealtimeState, action: Action): RealtimeState {
  switch (action.type) {
    case 'connection':
      return { ...state, connection: action.connection, connectionError: action.error ?? null };

    case 'session': {
      const users = { ...state.users, [action.user.id]: action.user };
      for (const user of action.directUsers) users[user.id] = user;
      // Mantém conversas abertas localmente que ainda não têm mensagens (o servidor só lista as com mensagens).
      const directs = { ...state.directs };
      for (const conversation of action.directs) directs[conversation.id] = conversation;
      return {
        ...state,
        connection: 'ready',
        connectionError: null,
        me: action.user,
        spaces: action.spaces,
        users,
        directs,
      };
    }

    case 'space:created':
      if (state.spaces.some((s) => s.id === action.space.id)) return state;
      return { ...state, spaces: [...state.spaces, action.space] };

    case 'channel:created': {
      const { channel, permissions } = action.payload;
      const snapshot = state.snapshot;
      if (!snapshot || snapshot.space.id !== channel.spaceId) return state;
      if (snapshot.channels.some((c) => c.id === channel.id)) return state;
      return {
        ...state,
        snapshot: {
          ...snapshot,
          channels: [...snapshot.channels, channel].sort((a, b) => a.position - b.position),
          permissions: { ...snapshot.permissions, [channel.id]: permissions },
        },
      };
    }

    case 'dm:upsert': {
      const { conversation, users: participants } = action.payload;
      const users = { ...state.users };
      for (const user of participants) users[user.id] = user;
      return { ...state, users, directs: { ...state.directs, [conversation.id]: conversation } };
    }

    case 'dm:select':
      return {
        ...state,
        activeSpaceId: null,
        activeDirectId: action.conversationId,
        unread: withoutKey(state.unread, action.conversationId),
      };

    case 'space:select':
      return {
        ...state,
        activeSpaceId: action.spaceId,
        snapshot: state.snapshot?.space.id === action.spaceId ? state.snapshot : null,
      };

    case 'space:snapshot': {
      if (action.snapshot.space.id !== state.activeSpaceId) return state; // resposta atrasada de outro espaço
      const users = { ...state.users };
      for (const user of action.snapshot.users) users[user.id] = user;
      const voice: Record<Id, VoiceParticipant[]> = {};
      for (const p of action.snapshot.voice) (voice[p.channelId] ??= []).push(p);
      return { ...state, snapshot: action.snapshot, users, voice };
    }

    case 'channel:select':
      return {
        ...state,
        activeChannelBySpace: { ...state.activeChannelBySpace, [action.spaceId]: action.channelId },
      };

    case 'messages:history': {
      const byId = new Map((state.messages[action.channelId] ?? []).map((m) => [m.id, m]));
      for (const message of action.messages) byId.set(message.id, message);
      const merged = [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return { ...state, messages: { ...state.messages, [action.channelId]: merged } };
    }

    case 'message:new': {
      const { channelId, authorId, id } = action.message;
      const list = state.messages[channelId] ?? [];
      if (list.some((m) => m.id === id)) return state;
      // Conta como não lida a mensagem direta de outra pessoa numa conversa que não está aberta.
      const isOpen = state.activeSpaceId === null && state.activeDirectId === channelId;
      const countsAsUnread = channelId in state.directs && authorId !== state.me?.id && !isOpen;
      return {
        ...state,
        messages: { ...state.messages, [channelId]: [...list, action.message] },
        typing: { ...state.typing, [channelId]: withoutKey(state.typing[channelId], authorId) },
        unread: countsAsUnread ? { ...state.unread, [channelId]: (state.unread[channelId] ?? 0) + 1 } : state.unread,
      };
    }

    case 'typing':
      return {
        ...state,
        typing: {
          ...state.typing,
          [action.channelId]: { ...state.typing[action.channelId], [action.userId]: action.until },
        },
      };

    case 'presence': {
      const user = state.users[action.userId];
      if (!user) return state;
      const updated = { ...user, status: action.status };
      return {
        ...state,
        users: { ...state.users, [action.userId]: updated },
        me: state.me?.id === action.userId ? updated : state.me,
      };
    }

    case 'member:joined': {
      const users = { ...state.users, [action.user.id]: action.user };
      const snapshot = state.snapshot;
      if (!snapshot || snapshot.space.id !== action.member.spaceId) return { ...state, users };
      if (snapshot.members.some((m) => m.userId === action.member.userId)) return { ...state, users };
      return { ...state, users, snapshot: { ...snapshot, members: [...snapshot.members, action.member] } };
    }

    case 'voice:update':
      return { ...state, voice: { ...state.voice, [action.channelId]: action.participants } };

    case 'voice:self':
      return { ...state, myVoice: { ...state.myVoice, ...action.patch } };
  }
}

export interface RealtimeActions {
  selectSpace(spaceId: Id | null): void;
  selectChannel(channelId: Id): void;
  /** Cria um espaço e abre ele. Resolve com erro ou `null`. */
  createSpace(name: string): Promise<string | null>;
  /** Cria um canal no espaço aberto e abre ele, se for de texto. Resolve com erro ou `null`. */
  createChannel(req: Omit<CreateChannelRequest, 'spaceId'>): Promise<string | null>;
  /** Abre (ou cria) a conversa direta com alguém. Resolve com erro ou `null`. */
  openDirect(userId: Id): Promise<string | null>;
  selectDirect(conversationId: Id): void;
  /** Envia para um canal de texto ou conversa direta. Resolve com erro ou `null`. */
  sendMessage(targetId: Id, content: string): Promise<string | null>;
  notifyTyping(targetId: Id): void;
  joinVoice(channelId: Id): void;
  leaveVoice(): void;
  toggleMute(): void;
  toggleDeafen(): void;
  dismissVoiceError(): void;
  setPresence(status: SelectableStatus): void;
}

interface RealtimeContextValue {
  state: RealtimeState;
  actions: RealtimeActions;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

export function RealtimeProvider({ identity, children }: { identity: Identity; children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const socketRef = useRef<AppSocket | null>(null);
  const voiceRef = useRef<VoiceManager | null>(null);
  const lastTypingRef = useRef<{ channelId: Id | null; at: number }>({ channelId: null, at: 0 });
  const firstSessionRef = useRef(true);

  const actions = useMemo<RealtimeActions>(() => {
    const emitVoiceState = (muted: boolean, deafened: boolean) =>
      socketRef.current?.emit('voice:state', { muted, deafened });

    const loadHistory = async (channelId: Id) => {
      const res = await socketRef.current?.emitWithAck('channel:history', { channelId });
      if (res?.ok) dispatch({ type: 'messages:history', channelId, messages: res.data });
    };

    const openChannel = (snapshot: SpaceSnapshot | null, channelId: Id) => {
      const channel = snapshot?.channels.find((c) => c.id === channelId);
      if (!snapshot || channel?.kind !== 'text') return;
      dispatch({ type: 'channel:select', spaceId: snapshot.space.id, channelId });
      // Sempre recarrega: cobre mensagens perdidas durante uma reconexão.
      void loadHistory(channelId);
    };

    const selectChannel = (channelId: Id) => openChannel(stateRef.current.snapshot, channelId);

    const selectDirect = (conversationId: Id) => {
      dispatch({ type: 'dm:select', conversationId });
      void loadHistory(conversationId);
    };

    const selectSpace = async (spaceId: Id | null) => {
      dispatch({ type: 'space:select', spaceId });
      const socket = socketRef.current;
      if (spaceId === null) {
        const { activeDirectId } = stateRef.current;
        if (activeDirectId) selectDirect(activeDirectId);
        return;
      }
      if (!socket) return;
      const res = await socket.emitWithAck('space:join', spaceId);
      if (!res.ok) {
        dispatch({ type: 'connection', connection: stateRef.current.connection, error: res.error });
        return;
      }
      if (stateRef.current.activeSpaceId !== spaceId) return; // o usuário já trocou de espaço
      dispatch({ type: 'space:snapshot', snapshot: res.data });
      const remembered = stateRef.current.activeChannelBySpace[spaceId];
      const target =
        res.data.channels.find((c) => c.id === remembered) ?? res.data.channels.find((c) => c.kind === 'text');
      if (target) openChannel(res.data, target.id);
    };

    return {
      selectSpace: (spaceId) => void selectSpace(spaceId),
      selectChannel,
      selectDirect,

      async createSpace(name) {
        const socket = socketRef.current;
        if (!socket) return 'Sem conexão com o servidor.';
        const res = await socket.emitWithAck('space:create', { name });
        if (!res.ok) return res.error;
        dispatch({ type: 'space:created', space: res.data });
        void selectSpace(res.data.id);
        return null;
      },

      async createChannel(req) {
        const socket = socketRef.current;
        const snapshot = stateRef.current.snapshot;
        if (!socket || !snapshot) return 'Sem conexão com o servidor.';
        const res = await socket.emitWithAck('channel:create', { ...req, spaceId: snapshot.space.id });
        if (!res.ok) return res.error;
        dispatch({ type: 'channel:created', payload: res.data });
        if (res.data.channel.kind === 'text') {
          openChannel(
            { ...snapshot, channels: [...snapshot.channels, res.data.channel] },
            res.data.channel.id,
          );
        }
        return null;
      },

      async openDirect(userId) {
        const socket = socketRef.current;
        if (!socket) return 'Sem conexão com o servidor.';
        const res = await socket.emitWithAck('dm:open', { userId });
        if (!res.ok) return res.error;
        dispatch({ type: 'dm:upsert', payload: res.data });
        selectDirect(res.data.conversation.id);
        return null;
      },

      async sendMessage(channelId, content) {
        const socket = socketRef.current;
        if (!socket) return 'Sem conexão com o servidor.';
        lastTypingRef.current = { channelId: null, at: 0 };
        try {
          const res = await socket.timeout(10_000).emitWithAck('message:send', { channelId, content });
          return res.ok ? null : res.error;
        } catch {
          return 'O servidor não respondeu. Tente de novo.';
        }
      },

      notifyTyping(channelId) {
        const now = Date.now();
        const last = lastTypingRef.current;
        if (last.channelId === channelId && now - last.at < TYPING_THROTTLE_MS) return;
        lastTypingRef.current = { channelId, at: now };
        socketRef.current?.emit('typing:start', { channelId });
      },

      joinVoice(channelId) {
        void (async () => {
          const { myVoice, snapshot } = stateRef.current;
          const voice = voiceRef.current;
          if (!voice || !snapshot || myVoice.connecting || myVoice.channelId === channelId) return;
          const channel = snapshot.channels.find((c) => c.id === channelId);
          const permissions = snapshot.permissions[channelId] ?? 0;
          if (channel?.kind !== 'voice' || !hasPermission(permissions, Permission.CONNECT)) return;
          const canSpeak = hasPermission(permissions, Permission.SPEAK);

          dispatch({ type: 'voice:self', patch: { connecting: true, error: null } });
          try {
            await voice.join(channelId, !canSpeak);
            dispatch({
              type: 'voice:self',
              patch: {
                channelId,
                channelName: channel.name,
                spaceName: snapshot.space.name,
                connecting: false,
                muted: !canSpeak,
                deafened: false,
                canSpeak,
              },
            });
            voice.setDeafened(false);
            if (!canSpeak) emitVoiceState(true, false);
          } catch (err) {
            dispatch({ type: 'voice:self', patch: { ...IDLE_VOICE, error: describeMediaError(err) } });
          }
        })();
      },

      leaveVoice() {
        voiceRef.current?.leave();
        dispatch({ type: 'voice:self', patch: IDLE_VOICE });
      },

      toggleMute() {
        const { myVoice } = stateRef.current;
        if (!myVoice.channelId || !myVoice.canSpeak) return;
        const muted = !myVoice.muted;
        const deafened = muted ? myVoice.deafened : false; // abrir o microfone também reativa o som
        voiceRef.current?.setMuted(muted);
        voiceRef.current?.setDeafened(deafened);
        dispatch({ type: 'voice:self', patch: { muted, deafened } });
        emitVoiceState(muted, deafened);
      },

      toggleDeafen() {
        const { myVoice } = stateRef.current;
        if (!myVoice.channelId) return;
        const deafened = !myVoice.deafened;
        const muted = deafened || !myVoice.canSpeak; // ensurdecer também fecha o microfone
        voiceRef.current?.setDeafened(deafened);
        voiceRef.current?.setMuted(muted);
        dispatch({ type: 'voice:self', patch: { muted, deafened } });
        emitVoiceState(muted, deafened);
      },

      dismissVoiceError() {
        dispatch({ type: 'voice:self', patch: { error: null } });
      },

      setPresence(status) {
        const me = stateRef.current.me;
        if (!me) return;
        dispatch({ type: 'presence', userId: me.id, status });
        socketRef.current?.emit('presence:set', status);
      },
    };
  }, []);

  useEffect(() => {
    const socket = createSocket(identity);
    const voice = new VoiceManager(socket);
    socketRef.current = socket;
    voiceRef.current = voice;
    firstSessionRef.current = true;

    socket.on('session:ready', ({ user, spaces, directs, directUsers }) => {
      dispatch({ type: 'session', user, spaces, directs, directUsers });
      // Na primeira conexão abre o primeiro espaço; nas reconexões, reabre o atual.
      const target = firstSessionRef.current ? (spaces[0]?.id ?? null) : stateRef.current.activeSpaceId;
      firstSessionRef.current = false;
      actions.selectSpace(target);
    });
    socket.on('space:created', (space) => dispatch({ type: 'space:created', space }));
    socket.on('channel:created', (payload) => dispatch({ type: 'channel:created', payload }));
    socket.on('dm:upsert', (payload) => dispatch({ type: 'dm:upsert', payload }));
    socket.on('message:new', (message) => dispatch({ type: 'message:new', message }));
    socket.on('typing', ({ channelId, userId }) =>
      dispatch({ type: 'typing', channelId, userId, until: Date.now() + TYPING_TTL_MS }),
    );
    socket.on('presence:update', ({ userId, status }) => dispatch({ type: 'presence', userId, status }));
    socket.on('member:joined', ({ member, user }) => dispatch({ type: 'member:joined', member, user }));
    socket.on('voice:update', ({ channelId, participants }) =>
      dispatch({ type: 'voice:update', channelId, participants }),
    );
    socket.on('voice:ended', ({ reason }) => {
      voice.teardown();
      dispatch({ type: 'voice:self', patch: { ...IDLE_VOICE, error: reason } });
    });
    socket.on('disconnect', () => {
      // O servidor encerra a sessão de voz quando o socket cai.
      voice.teardown();
      dispatch({ type: 'voice:self', patch: IDLE_VOICE });
      dispatch({ type: 'connection', connection: 'disconnected' });
    });
    socket.on('connect_error', (err) =>
      dispatch({ type: 'connection', connection: 'disconnected', error: err.message }),
    );

    dispatch({ type: 'connection', connection: 'connecting' });
    socket.connect();

    return () => {
      voice.leave();
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
      voiceRef.current = null;
    };
  }, [identity, actions]);

  const value = useMemo(() => ({ state, actions }), [state, actions]);
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime(): RealtimeContextValue {
  const value = useContext(RealtimeContext);
  if (!value) throw new Error('useRealtime precisa estar dentro de <RealtimeProvider>.');
  return value;
}

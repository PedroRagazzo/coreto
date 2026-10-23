// Estado global em tempo real: um socket por sessão, eventos do servidor
// viram ações do reducer, e os componentes chamam `actions` para agir.

import type {
  Channel,
  DirectConversation,
  Id,
  Member,
  MentionCount,
  LinkPreview,
  Message,
  Poll,
  PresenceStatus,
  Reaction,
  Roulette,
  Space,
  SpaceSnapshot,
  UnreadCount,
  User,
  VoiceParticipant,
} from '@shared/models';
import type { ConnectionQuality } from '@shared/connection-quality';
import { firstLink } from '@shared/links';
import { ROULETTE_SPIN_MS } from '@shared/polls';
import { toastFor } from '@shared/notify';
import { hasPermission, Permission } from '@shared/permissions';
import { deletedReply, replyPreviewOf } from '@shared/reply';
import {
  HISTORY_PAGE_SIZE,
  INVALID_SESSION,
  type ChannelCreatedPayload,
  type CreateChannelRequest,
  type Ack,
  type DirectConversationPayload,
  type MusicControl,
  type MusicState,
  type SearchRequest,
  type SearchResult,
  type SelectableStatus,
  type UpdateChannelRequest,
} from '@shared/protocol';
import { createContext, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';
import type { Identity } from '../lib/identity';
import { createSocket, type AppSocket } from '../lib/socket';
import { useWindowActive, isWindowActive } from '../lib/focus';
import { bringWindowToFront, showToast } from '../lib/notifications';
import { uploadImage, type UploadHandle } from '../lib/uploads';
import { DEFAULT_SETTINGS } from '../lib/settings';
import { displayNameOf } from './selectors';
import { useSettings } from './settings';
import {
  describeCameraError,
  describeMediaError,
  describeScreenError,
  VoiceManager,
  type ScreenShareOptions,
  type StreamStats,
} from '../lib/voice';

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
  /** Tem a permissão STREAM na sala (guardada ao entrar, vale mesmo em outro espaço). */
  canStream: boolean;
  /** Você está compartilhando a tela. */
  streaming: boolean;
  /** Sua câmera está ligada. */
  video: boolean;
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
  /** Roletas que acabaram de girar ao vivo (mensagem → `true`): só elas animam; as que já tinham resultado aparecem paradas. */
  freshSpins: Record<Id, true>;
  /** link → o cartão de pré-visualização (`null` se a página não tem o que mostrar); ausente = ainda não pedido */
  linkPreviews: Record<string, LinkPreview | null>;
  /** canal de texto ou conversa direta → mensagens de outras pessoas ainda não lidas (some o que está zerado) */
  unread: Record<Id, UnreadCount>;
  users: Record<Id, User>;
  /** canal de texto ou conversa direta → mensagens */
  messages: Record<Id, Message[]>;
  /** canal ou conversa → usuário → instante (ms) em que o aviso de digitação expira */
  typing: Record<Id, Record<Id, number>>;
  /** Conversas cujo histórico já foi carregado até a primeira mensagem. */
  historyComplete: Record<Id, true>;
  /** Conversas buscando uma página de mensagens antigas agora. */
  loadingOlder: Record<Id, true>;
  voice: Record<Id, VoiceParticipant[]>;
  myVoice: MyVoiceState;
  /** canal → menções suas ainda não vistas (de todos os espaços) */
  mentions: Record<Id, MentionCount>;
  /** Quem está falando agora na sua chamada (medido localmente). */
  speaking: Record<Id, true>;
  /** A qualidade da conexão com cada pessoa da sua chamada, e a sua quando dá para saber (medido localmente). */
  quality: Record<Id, ConnectionQuality>;
  /** O bot de música na sua sala de voz, com a hora local em que o estado chegou (para andar a barra de progresso). */
  music: { state: MusicState; receivedAt: number } | null;
  /** Sua tela, enquanto você transmite (para a prévia). */
  myScreen: MediaStream | null;
  /** Telas que chegam de outras pessoas da chamada, por quem transmite. */
  screens: Record<Id, MediaStream>;
  /** A mensagem que a pessoa está respondendo no campo de texto; `null` se não está respondendo nenhuma. */
  replyingTo: Message | null;
  /** Transmissões abertas no painel central (a sua, para a prévia, e as de quem você assiste), na ordem em que abriram. */
  stages: Id[];
  /** A transmissão em destaque (a maior, e a que toca som); sempre uma das abertas, ou `null` se não há nenhuma. */
  focusedStage: Id | null;
  /** Com várias abertas: uma grande e as outras pequenas (`focus`), ou todas do mesmo tamanho (`grid`). */
  stageLayout: 'focus' | 'grid';
  /** Sua câmera, enquanto ligada (para o seu quadro no mosaico). */
  myCamera: MediaStream | null;
  /** Câmeras que chegam de outras pessoas da chamada. */
  cameras: Record<Id, MediaStream>;
  /** O painel central mostra o mosaico da chamada (em vez do chat). */
  callView: boolean;
  /** Conversas cuja lista não chega até a mensagem mais recente (depois de pular para uma antiga). */
  detached: Record<Id, true>;
  /** Mensagem para rolar até e destacar (resultado de busca). */
  focus: { channelId: Id; messageId: Id } | null;
}

const IDLE_VOICE: MyVoiceState = {
  channelId: null,
  channelName: null,
  spaceName: null,
  connecting: false,
  muted: false,
  deafened: false,
  canSpeak: true,
  canStream: false,
  streaming: false,
  video: false,
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
  freshSpins: {},
  linkPreviews: {},
  unread: {},
  users: {},
  messages: {},
  typing: {},
  historyComplete: {},
  loadingOlder: {},
  voice: {},
  myVoice: IDLE_VOICE,
  mentions: {},
  speaking: {},
  quality: {},
  music: null,
  myScreen: null,
  screens: {},
  replyingTo: null,
  stages: [],
  focusedStage: null,
  stageLayout: 'focus',
  myCamera: null,
  cameras: {},
  callView: false,
  detached: {},
  focus: null,
};

type Action =
  | { type: 'connection'; connection: RealtimeState['connection']; error?: string }
  | {
      type: 'session';
      user: User;
      spaces: Space[];
      directs: DirectConversation[];
      directUsers: User[];
      mentions: MentionCount[];
      unread: UnreadCount[];
    }
  | { type: 'unread:bump'; channelId: Id; spaceId: Id | null }
  | { type: 'unread:clear'; channelId: Id }
  | { type: 'space:created'; space: Space }
  | { type: 'space:updated'; space: Space }
  | { type: 'space:deleted'; spaceId: Id }
  | { type: 'channel:created'; payload: ChannelCreatedPayload }
  | { type: 'channel:updated'; channel: Channel }
  | { type: 'channel:deleted'; spaceId: Id; channelId: Id }
  | { type: 'dm:upsert'; payload: DirectConversationPayload }
  | { type: 'dm:select'; conversationId: Id }
  | { type: 'space:select'; spaceId: Id | null }
  | { type: 'space:snapshot'; snapshot: SpaceSnapshot }
  | { type: 'channel:select'; spaceId: Id; channelId: Id }
  | { type: 'messages:history'; channelId: Id; messages: Message[]; reachedStart: boolean; latest?: boolean }
  | { type: 'messages:newer'; channelId: Id; messages: Message[]; reachedEnd: boolean }
  | {
      type: 'messages:context';
      channelId: Id;
      messages: Message[];
      reachedStart: boolean;
      reachedEnd: boolean;
      focusId: Id;
    }
  | { type: 'focus:clear' }
  | { type: 'history:loading'; channelId: Id; loading: boolean }
  | { type: 'message:new'; message: Message }
  | { type: 'message:updated'; message: Message }
  | { type: 'message:deleted'; channelId: Id; messageId: Id }
  | { type: 'message:reactions'; channelId: Id; messageId: Id; reactions: Reaction[] }
  | { type: 'poll:updated'; channelId: Id; messageId: Id; poll: Poll }
  | { type: 'roulette:spun'; channelId: Id; messageId: Id; roulette: Roulette }
  | { type: 'roulette:settled'; messageId: Id }
  | { type: 'link:preview'; url: string; preview: LinkPreview | null }
  | { type: 'reply:start'; message: Message }
  | { type: 'reply:cancel' }
  | { type: 'typing'; channelId: Id; userId: Id; until: number }
  | { type: 'presence'; userId: Id; status: PresenceStatus }
  | { type: 'member:joined'; member: Member; user: User }
  | { type: 'voice:update'; channelId: Id; participants: VoiceParticipant[] }
  | { type: 'voice:self'; patch: Partial<MyVoiceState> }
  | { type: 'mentions:update'; mention: MentionCount }
  | { type: 'speaking'; userIds: Id[] }
  | { type: 'quality'; quality: Record<Id, ConnectionQuality> }
  | { type: 'music:state'; state: MusicState | null }
  | { type: 'screen:mine'; stream: MediaStream | null }
  | { type: 'screen:remote'; userId: Id; stream: MediaStream | null }
  | { type: 'stage:open'; userId: Id }
  | { type: 'stage:close'; userId: Id | null }
  | { type: 'stage:focus'; userId: Id }
  | { type: 'stage:layout'; layout: 'focus' | 'grid' }
  | { type: 'camera:mine'; stream: MediaStream | null }
  | { type: 'camera:remote'; userId: Id; stream: MediaStream | null }
  | { type: 'callView'; open: boolean };

function withoutKey<T>(record: Record<Id, T> | undefined, key: Id): Record<Id, T> {
  const { [key]: _removed, ...rest } = record ?? {};
  return rest;
}

/** O que muda ao fechar uma transmissão aberta; se era a em destaque, o destaque passa para a última que sobrou. */
function closeStage(state: RealtimeState, userId: Id): Pick<RealtimeState, 'stages' | 'focusedStage'> {
  if (!state.stages.includes(userId)) return { stages: state.stages, focusedStage: state.focusedStage };
  const stages = state.stages.filter((id) => id !== userId);
  const focusedStage = state.focusedStage === userId ? (stages[stages.length - 1] ?? null) : state.focusedStage;
  return { stages, focusedStage };
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
      const mentions: Record<Id, MentionCount> = {};
      for (const mention of action.mentions) mentions[mention.channelId] = mention;
      const unread: Record<Id, UnreadCount> = {};
      for (const entry of action.unread) unread[entry.channelId] = entry;
      return {
        ...state,
        unread,
        connection: 'ready',
        connectionError: null,
        me: action.user,
        spaces: action.spaces,
        users,
        directs,
        mentions,
      };
    }

    case 'space:created':
      if (state.spaces.some((s) => s.id === action.space.id)) return state;
      return { ...state, spaces: [...state.spaces, action.space] };

    case 'space:updated':
      return {
        ...state,
        spaces: state.spaces.map((s) => (s.id === action.space.id ? action.space : s)),
        snapshot: state.snapshot?.space.id === action.space.id ? { ...state.snapshot, space: action.space } : state.snapshot,
      };

    case 'space:deleted': {
      const wasOpen = state.snapshot?.space.id === action.spaceId;
      return {
        ...state,
        spaces: state.spaces.filter((s) => s.id !== action.spaceId),
        activeChannelBySpace: withoutKey(state.activeChannelBySpace, action.spaceId),
        snapshot: wasOpen ? null : state.snapshot,
        voice: wasOpen ? {} : state.voice,
        mentions: Object.fromEntries(Object.entries(state.mentions).filter(([, m]) => m.spaceId !== action.spaceId)),
      };
    }

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

    case 'channel:updated': {
      const snapshot = state.snapshot;
      if (!snapshot || !snapshot.channels.some((c) => c.id === action.channel.id)) return state;
      const channels = snapshot.channels
        .map((c) => (c.id === action.channel.id ? action.channel : c))
        .sort((a, b) => a.position - b.position);
      return { ...state, snapshot: { ...snapshot, channels } };
    }

    case 'channel:deleted': {
      const { spaceId, channelId } = action;
      const snapshot = state.snapshot;
      const activeChannelBySpace =
        state.activeChannelBySpace[spaceId] === channelId
          ? withoutKey(state.activeChannelBySpace, spaceId)
          : state.activeChannelBySpace;
      return {
        ...state,
        activeChannelBySpace,
        snapshot:
          snapshot?.space.id === spaceId
            ? {
                ...snapshot,
                channels: snapshot.channels.filter((c) => c.id !== channelId),
                permissions: withoutKey(snapshot.permissions, channelId),
              }
            : snapshot,
        messages: withoutKey(state.messages, channelId),
        typing: withoutKey(state.typing, channelId),
        voice: withoutKey(state.voice, channelId),
        mentions: withoutKey(state.mentions, channelId),
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
        replyingTo: null,
        stages: [],
        focusedStage: null,
        callView: false,
        activeSpaceId: null,
        activeDirectId: action.conversationId,
      };

    case 'unread:bump': {
      const current = state.unread[action.channelId];
      return {
        ...state,
        unread: {
          ...state.unread,
          [action.channelId]: { channelId: action.channelId, spaceId: action.spaceId, count: (current?.count ?? 0) + 1 },
        },
      };
    }

    case 'unread:clear':
      return state.unread[action.channelId] ? { ...state, unread: withoutKey(state.unread, action.channelId) } : state;

    case 'space:select':
      return {
        ...state,
        replyingTo: null,
        stages: [],
        focusedStage: null,
        callView: false,
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
        replyingTo: null,
        stages: [],
        focusedStage: null,
        callView: false,
        activeChannelBySpace: { ...state.activeChannelBySpace, [action.spaceId]: action.channelId },
      };

    case 'messages:history': {
      // A página mais recente não emenda numa lista que parou no passado: substitui.
      if (action.latest && state.detached[action.channelId]) {
        return {
          ...state,
          messages: { ...state.messages, [action.channelId]: action.messages },
          detached: withoutKey(state.detached, action.channelId),
          historyComplete: action.reachedStart
            ? { ...state.historyComplete, [action.channelId]: true }
            : withoutKey(state.historyComplete, action.channelId),
        };
      }
      const byId = new Map((state.messages[action.channelId] ?? []).map((m) => [m.id, m]));
      for (const message of action.messages) byId.set(message.id, message);
      const merged = [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return {
        ...state,
        messages: { ...state.messages, [action.channelId]: merged },
        // Uma vez no começo, continua no começo (a página mais recente não desfaz isso).
        historyComplete:
          action.reachedStart && !state.historyComplete[action.channelId]
            ? { ...state.historyComplete, [action.channelId]: true }
            : state.historyComplete,
      };
    }

    case 'messages:newer': {
      const byId = new Map((state.messages[action.channelId] ?? []).map((m) => [m.id, m]));
      for (const message of action.messages) byId.set(message.id, message);
      return {
        ...state,
        messages: {
          ...state.messages,
          [action.channelId]: [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
        },
        detached: action.reachedEnd ? withoutKey(state.detached, action.channelId) : state.detached,
      };
    }

    case 'messages:context':
      return {
        ...state,
        messages: { ...state.messages, [action.channelId]: action.messages },
        historyComplete: action.reachedStart
          ? { ...state.historyComplete, [action.channelId]: true }
          : withoutKey(state.historyComplete, action.channelId),
        detached: action.reachedEnd
          ? withoutKey(state.detached, action.channelId)
          : { ...state.detached, [action.channelId]: true },
        focus: { channelId: action.channelId, messageId: action.focusId },
      };

    case 'focus:clear':
      return { ...state, focus: null };

    case 'history:loading':
      return {
        ...state,
        loadingOlder: action.loading
          ? { ...state.loadingOlder, [action.channelId]: true }
          : withoutKey(state.loadingOlder, action.channelId),
      };

    case 'message:updated': {
      const { channelId, id } = action.message;
      const list = state.messages[channelId];
      if (!list?.some((m) => m.id === id)) return state;
      return {
        ...state,
        // As respostas a esta mensagem mostram o texto novo dela.
        messages: {
          ...state.messages,
          [channelId]: list.map((m) =>
            m.id === id ? action.message : m.replyTo?.id === id && !m.replyTo.deleted ? { ...m, replyTo: replyPreviewOf(action.message) } : m,
          ),
        },
        replyingTo: state.replyingTo?.id === id ? action.message : state.replyingTo,
      };
    }

    case 'message:deleted': {
      const list = state.messages[action.channelId];
      if (!list) return state;
      return {
        ...state,
        // As respostas continuam, mostrando que a original sumiu.
        messages: {
          ...state.messages,
          [action.channelId]: list
            .filter((m) => m.id !== action.messageId)
            .map((m) => (m.replyTo?.id === action.messageId ? { ...m, replyTo: deletedReply(action.messageId) } : m)),
        },
        replyingTo: state.replyingTo?.id === action.messageId ? null : state.replyingTo,
      };
    }

    case 'message:reactions': {
      const list = state.messages[action.channelId];
      if (!list?.some((m) => m.id === action.messageId)) return state;
      return {
        ...state,
        messages: {
          ...state.messages,
          [action.channelId]: list.map((m) => (m.id === action.messageId ? { ...m, reactions: action.reactions } : m)),
        },
      };
    }

    case 'poll:updated': {
      const list = state.messages[action.channelId];
      if (!list?.some((m) => m.id === action.messageId)) return state;
      return {
        ...state,
        messages: {
          ...state.messages,
          [action.channelId]: list.map((m) => (m.id === action.messageId ? { ...m, poll: action.poll } : m)),
        },
      };
    }

    case 'roulette:spun': {
      const list = state.messages[action.channelId];
      if (!list?.some((m) => m.id === action.messageId)) return state;
      return {
        ...state,
        freshSpins: { ...state.freshSpins, [action.messageId]: true },
        messages: {
          ...state.messages,
          [action.channelId]: list.map((m) => (m.id === action.messageId ? { ...m, roulette: action.roulette } : m)),
        },
      };
    }

    case 'roulette:settled':
      return state.freshSpins[action.messageId] ? { ...state, freshSpins: withoutKey(state.freshSpins, action.messageId) } : state;

    case 'link:preview':
      return { ...state, linkPreviews: { ...state.linkPreviews, [action.url]: action.preview } };

    case 'reply:start':
      return { ...state, replyingTo: action.message };

    case 'reply:cancel':
      return state.replyingTo ? { ...state, replyingTo: null } : state;

    case 'message:new': {
      const { channelId, authorId, id } = action.message;
      const list = state.messages[channelId] ?? [];
      if (list.some((m) => m.id === id)) return state;
      // Lista parada no passado: a mensagem nova chega quando ela voltar ao presente.
      if (state.detached[channelId]) return state;
      return {
        ...state,
        messages: { ...state.messages, [channelId]: [...list, action.message] },
        typing: { ...state.typing, [channelId]: withoutKey(state.typing[channelId], authorId) },
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

    case 'voice:self': {
      const myVoice = { ...state.myVoice, ...action.patch };
      // Saiu da chamada: acabam a transmissão, as telas recebidas e o palco.
      if (myVoice.channelId === null && state.myVoice.channelId !== null) {
        return {
          ...state,
          myVoice: { ...myVoice, streaming: false, video: false },
          music: null,
          myScreen: null,
          screens: {},
          stages: [],
          focusedStage: null,
          myCamera: null,
          cameras: {},
          callView: false,
        };
      }
      return { ...state, myVoice };
    }

    case 'mentions:update': {
      const { mention } = action;
      return {
        ...state,
        mentions:
          mention.count > 0
            ? { ...state.mentions, [mention.channelId]: mention }
            : withoutKey(state.mentions, mention.channelId),
      };
    }

    case 'speaking':
      return { ...state, speaking: Object.fromEntries(action.userIds.map((id) => [id, true as const])) };

    case 'quality':
      return { ...state, quality: action.quality };

    case 'music:state':
      return { ...state, music: action.state ? { state: action.state, receivedAt: Date.now() } : null };

    case 'screen:mine':
      return {
        ...state,
        myScreen: action.stream,
        myVoice: { ...state.myVoice, streaming: action.stream !== null },
        ...(action.stream === null && state.me ? closeStage(state, state.me.id) : {}),
      };

    case 'screen:remote':
      return {
        ...state,
        screens: action.stream
          ? { ...state.screens, [action.userId]: action.stream }
          : withoutKey(state.screens, action.userId),
      };

    case 'stage:open':
      // Abrir uma transmissão já aberta só a põe em destaque; uma nova entra no fim e também fica em destaque.
      return {
        ...state,
        stages: state.stages.includes(action.userId) ? state.stages : [...state.stages, action.userId],
        focusedStage: action.userId,
      };

    case 'stage:close':
      return { ...state, ...(action.userId === null ? { stages: [], focusedStage: null } : closeStage(state, action.userId)) };

    case 'stage:focus':
      return state.stages.includes(action.userId) ? { ...state, focusedStage: action.userId } : state;

    case 'stage:layout':
      return { ...state, stageLayout: action.layout };

    case 'camera:mine':
      return { ...state, myCamera: action.stream, myVoice: { ...state.myVoice, video: action.stream !== null } };

    case 'camera:remote':
      return {
        ...state,
        cameras: action.stream
          ? { ...state.cameras, [action.userId]: action.stream }
          : withoutKey(state.cameras, action.userId),
      };

    case 'callView':
      return { ...state, callView: action.open };
  }
}

export interface RealtimeActions {
  selectSpace(spaceId: Id | null): void;
  selectChannel(channelId: Id): void;
  /** Cria um espaço e abre ele. Resolve com erro ou `null`. */
  createSpace(name: string): Promise<string | null>;
  /** Renomeia o espaço aberto. Resolve com erro ou `null`. */
  renameSpace(name: string): Promise<string | null>;
  /** Exclui o espaço aberto com tudo dentro. Resolve com erro ou `null`. */
  deleteSpace(): Promise<string | null>;
  /** Cria um canal no espaço aberto e abre ele, se for de texto. Resolve com erro ou `null`. */
  createChannel(req: Omit<CreateChannelRequest, 'spaceId'>): Promise<string | null>;
  /** Altera nome, tópico ou categoria. Resolve com erro ou `null`. */
  updateChannel(req: UpdateChannelRequest): Promise<string | null>;
  /** Exclui o canal e as mensagens dele. Resolve com erro ou `null`. */
  deleteChannel(channelId: Id): Promise<string | null>;
  /** Abre (ou cria) a conversa direta com alguém. Resolve com erro ou `null`. */
  openDirect(userId: Id): Promise<string | null>;
  selectDirect(conversationId: Id): void;
  /** Envia para um canal de texto ou conversa direta, com anexos já enviados. Resolve com erro ou `null`. */
  sendMessage(targetId: Id, content: string, attachmentIds?: Id[], replyToId?: Id): Promise<string | null>;
  /** Cria uma enquete no canal ou conversa. Resolve com o erro, ou `null` quando deu certo (a mensagem chega pelo evento). */
  createPoll(targetId: Id, poll: { question: string; options: string[]; multiple: boolean }): Promise<string | null>;
  /** Cria uma roleta no canal ou conversa. Resolve com o erro, ou `null`. */
  createRoulette(targetId: Id, roulette: { title: string; options: string[] }): Promise<string | null>;
  /** Vota na opção (ou tira o voto). Resolve com o erro, ou `null`. */
  votePoll(messageId: Id, optionId: Id): Promise<string | null>;
  /** Encerra a enquete (quem criou, ou quem modera o canal). Resolve com o erro, ou `null`. */
  closePoll(messageId: Id): Promise<string | null>;
  /** Gira a roleta; o servidor sorteia e todo mundo vê o mesmo resultado. Resolve com o erro, ou `null`. */
  spinRoulette(messageId: Id): Promise<string | null>;
  /** Pede ao servidor o cartão do primeiro link da mensagem (uma vez por link); o resultado vai para `state.linkPreviews`. */
  requestLinkPreview(message: Message): void;
  /** Começa a responder a uma mensagem: o campo de texto mostra a quem e o envio leva a resposta. */
  startReply(message: Message): void;
  cancelReply(): void;
  /** Reage à mensagem com o emoji, ou tira a reação se já tinha. Resolve com erro ou `null`. */
  toggleReaction(messageId: Id, emoji: string): Promise<string | null>;
  /** Envia uma imagem para anexar depois em `sendMessage`. */
  uploadImage(file: File, onProgress: (fraction: number) => void): UploadHandle;
  /** Busca a página anterior à mensagem mais antiga carregada. */
  loadOlder(targetId: Id): void;
  /** Edita uma mensagem sua. Resolve com erro ou `null`. */
  editMessage(messageId: Id, content: string): Promise<string | null>;
  /** Apaga uma mensagem (sua, ou de outros se você modera o canal). Resolve com erro ou `null`. */
  deleteMessage(messageId: Id): Promise<string | null>;
  notifyTyping(targetId: Id): void;
  joinVoice(channelId: Id): void;
  /** Abre o seletor de tela e começa a transmitir. Resolve com erro ou `null` (também se a pessoa cancelar). */
  startScreenShare(options: ScreenShareOptions): Promise<string | null>;
  stopScreenShare(): void;
  /** Pede uma música ao bot (link do YouTube/Spotify ou busca). Devolve o aviso para mostrar, ou o motivo da recusa. */
  musicPlay(input: string, next?: boolean): Promise<{ message: string } | { error: string }>;
  /** Controla o bot de música (pular, pausar, volume...). Devolve o motivo da recusa, ou `null`. */
  musicControl(request: MusicControl): Promise<string | null>;
  /** As opções da transmissão em andamento, ou `null` se você não está transmitindo. */
  screenOptions(): ScreenShareOptions | null;
  /** Muda a qualidade com a transmissão no ar; devolve as opções valendo, ou `null` se ela acabou. */
  updateScreenOptions(patch: Partial<Pick<ScreenShareOptions, 'height' | 'frameRate' | 'priority' | 'uploadMbps' | 'codec'>>): Promise<ScreenShareOptions | null>;
  /** Como a transmissão (sua ou a que você assiste) está indo agora; `null` se não há dados. */
  screenStats(userId: Id): Promise<StreamStats | null>;
  /** Miniatura da tela de quem está ao vivo (JPEG em data URL); `null` se ainda não há. */
  streamPreview(userId: Id): Promise<string | null>;
  /**
   * Assiste à transmissão de alguém, entrando no canal de voz dela se preciso.
   * Para você, abre a prévia. Falhas aparecem como aviso na barra de voz.
   */
  watchStream(userId: Id): void;
  /** Fecha uma transmissão aberta (a de `userId`, ou todas sem ele) e para de receber a tela de quem você assistia. */
  closeStage(userId?: Id): void;
  /** Põe uma das transmissões abertas em destaque (a maior, com som). */
  focusStage(userId: Id): void;
  /** Várias abertas: uma grande e as outras pequenas, ou todas do mesmo tamanho. */
  setStageLayout(layout: 'focus' | 'grid'): void;
  /** Liga ou desliga a câmera; falhas aparecem como aviso na barra de voz. */
  toggleCamera(): void;
  /** Entra no canal de voz (se ainda não estiver nele) e abre o mosaico da chamada. */
  openCall(channelId: Id): void;
  closeCall(): void;
  /** Abre a conversa da mensagem e rola até ela, carregando o histórico em volta. */
  jumpToMessage(message: Pick<Message, 'id'>): Promise<string | null>;
  /** Carrega as mensagens seguintes de uma lista parada no passado. */
  loadNewer(targetId: Id): void;
  /** Volta para as mensagens mais recentes (descarta a janela do passado). */
  jumpToPresent(targetId: Id): void;
  focusDone(): void;
  search(req: SearchRequest): Promise<Ack<SearchResult>>;
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

interface RealtimeProviderProps {
  identity: Identity;
  /** O servidor recusou a sessão guardada: é preciso entrar de novo. */
  onSessionInvalid: () => void;
  children: ReactNode;
}

export function RealtimeProvider({ identity, onSessionInvalid, children }: RealtimeProviderProps) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const onSessionInvalidRef = useRef(onSessionInvalid);
  onSessionInvalidRef.current = onSessionInvalid;
  const stateRef = useRef(state);
  stateRef.current = state;

  const socketRef = useRef<AppSocket | null>(null);
  const voiceRef = useRef<VoiceManager | null>(null);
  const lastTypingRef = useRef<{ channelId: Id | null; at: number }>({ channelId: null, at: 0 });
  /** Links cujo cartão já foi pedido (um pedido por link, mesmo que ele apareça em várias mensagens). */
  const previewsAskedRef = useRef(new Set<string>());
  /** As preferências de notificação valem na hora, sem refazer a conexão com o servidor. */
  const notificationPrefsRef = useRef(DEFAULT_SETTINGS.notifications);
  const firstSessionRef = useRef(true);
  const identityRef = useRef(identity);
  identityRef.current = identity;

  /** Faz um pedido ao servidor e devolve o erro para mostrar (ou `null` se deu certo). */
  const ask = async (send: (socket: AppSocket) => Promise<Ack<unknown>>): Promise<string | null> => {
    const socket = socketRef.current;
    if (!socket) return 'Sem conexão com o servidor.';
    try {
      const res = await send(socket);
      return res.ok ? null : res.error;
    } catch {
      return 'O servidor não respondeu. Tente de novo.';
    }
  };

  const actions = useMemo<RealtimeActions>(() => {
    const emitVoiceState = (muted: boolean, deafened: boolean) =>
      socketRef.current?.emit('voice:state', { muted, deafened });

    const loadHistory = async (channelId: Id) => {
      const res = await socketRef.current?.emitWithAck('channel:history', { channelId });
      if (res?.ok) {
        const reachedStart = res.data.length < HISTORY_PAGE_SIZE;
        dispatch({ type: 'messages:history', channelId, messages: res.data, reachedStart, latest: true });
      }
    };

    const openChannel = (snapshot: SpaceSnapshot | null, channelId: Id, { keepHistory = false } = {}) => {
      const channel = snapshot?.channels.find((c) => c.id === channelId);
      if (!snapshot || channel?.kind !== 'text') return;
      dispatch({ type: 'channel:select', spaceId: snapshot.space.id, channelId });
      // Recarrega a página mais recente (cobre mensagens perdidas numa reconexão), menos ao
      // pular para uma mensagem antiga: aí a lista já foi montada em volta dela.
      if (!keepHistory && !stateRef.current.detached[channelId]) void loadHistory(channelId);
    };

    const selectChannel = (channelId: Id) => openChannel(stateRef.current.snapshot, channelId);

    /** Entra num canal de voz do espaço aberto; resolve `true` se ficou conectado a ele. */
    const joinVoice = async (channelId: Id): Promise<boolean> => {
      const { myVoice, snapshot, me } = stateRef.current;
      const voice = voiceRef.current;
      if (myVoice.channelId === channelId) return true;
      if (!voice || !snapshot || !me || myVoice.connecting) return false;
      const channel = snapshot.channels.find((c) => c.id === channelId);
      const permissions = snapshot.permissions[channelId] ?? 0;
      if (channel?.kind !== 'voice' || !hasPermission(permissions, Permission.CONNECT)) return false;
      const canSpeak = hasPermission(permissions, Permission.SPEAK);

      // Trocar de sala encerra a anterior (e a transmissão dela).
      if (myVoice.channelId) dispatch({ type: 'voice:self', patch: IDLE_VOICE });
      dispatch({ type: 'voice:self', patch: { connecting: true, error: null } });
      try {
        await voice.join(channelId, !canSpeak, me.id);
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
            canStream: hasPermission(permissions, Permission.STREAM),
          },
        });
        voice.setDeafened(false);
        if (!canSpeak) emitVoiceState(true, false);
        return true;
      } catch (err) {
        dispatch({ type: 'voice:self', patch: { ...IDLE_VOICE, error: describeMediaError(err) } });
        return false;
      }
    };

    const selectDirect = (conversationId: Id) => {
      dispatch({ type: 'dm:select', conversationId });
      void loadHistory(conversationId);
    };

    const selectSpace = async (spaceId: Id | null, focusChannelId?: Id) => {
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
      if (focusChannelId) return openChannel(res.data, focusChannelId, { keepHistory: true });
      const remembered = stateRef.current.activeChannelBySpace[spaceId];
      const target =
        res.data.channels.find((c) => c.id === remembered) ?? res.data.channels.find((c) => c.kind === 'text');
      if (target) openChannel(res.data, target.id);
    };

    /** Abre a transmissão de alguém; resolve com o erro ou `null`. */
    const watchStream = async (userId: Id): Promise<string | null> => {
      const socket = socketRef.current;
      const { me, voice } = stateRef.current;
      if (!socket || !me) return 'Sem conexão com o servidor.';
      if (userId === me.id) {
        dispatch({ type: 'stage:open', userId });
        return null;
      }
      const channelId = Object.keys(voice).find((id) => voice[id].some((p) => p.userId === userId && p.streaming));
      if (!channelId) return 'Essa transmissão já terminou.';
      // Como no Discord: assistir entra na chamada de quem transmite.
      if (stateRef.current.myVoice.channelId !== channelId && !(await joinVoice(channelId))) {
        return stateRef.current.myVoice.error ?? 'Não foi possível entrar no canal de voz.';
      }
      // O palco abre antes do pedido: a lista da sala com você assistindo chega antes da resposta,
      // e sem o palco aberto o efeito que cancela transmissões "esquecidas" pararia esta.
      dispatch({ type: 'stage:open', userId });
      const res = await socket.emitWithAck('stream:watch', { userId });
      if (!res.ok) {
        dispatch({ type: 'stage:close', userId });
        return res.error;
      }
      return null;
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

      async renameSpace(name) {
        const socket = socketRef.current;
        const spaceId = stateRef.current.snapshot?.space.id;
        if (!socket || !spaceId) return 'Sem conexão com o servidor.';
        const res = await socket.emitWithAck('space:update', { spaceId, name });
        if (!res.ok) return res.error;
        dispatch({ type: 'space:updated', space: res.data });
        return null;
      },

      async deleteSpace() {
        const socket = socketRef.current;
        const spaceId = stateRef.current.snapshot?.space.id;
        if (!socket || !spaceId) return 'Sem conexão com o servidor.';
        // O estado é atualizado pelo evento `space:deleted`, que chega para todos.
        const res = await socket.emitWithAck('space:delete', { spaceId });
        return res.ok ? null : res.error;
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

      async updateChannel(req) {
        const socket = socketRef.current;
        if (!socket) return 'Sem conexão com o servidor.';
        const res = await socket.emitWithAck('channel:update', req);
        if (!res.ok) return res.error;
        dispatch({ type: 'channel:updated', channel: res.data });
        return null;
      },

      async deleteChannel(channelId) {
        const socket = socketRef.current;
        if (!socket) return 'Sem conexão com o servidor.';
        // O estado é atualizado pelo evento `channel:deleted`, que chega para todos no espaço.
        const res = await socket.emitWithAck('channel:delete', { channelId });
        return res.ok ? null : res.error;
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

      loadOlder(channelId) {
        const { historyComplete, loadingOlder, messages } = stateRef.current;
        const oldest = messages[channelId]?.[0];
        const socket = socketRef.current;
        if (!socket || !oldest || historyComplete[channelId] || loadingOlder[channelId]) return;
        dispatch({ type: 'history:loading', channelId, loading: true });
        void socket
          .emitWithAck('channel:history', { channelId, before: oldest.id, limit: HISTORY_PAGE_SIZE })
          .then((res) => {
            if (res.ok) {
              const reachedStart = res.data.length < HISTORY_PAGE_SIZE;
              dispatch({ type: 'messages:history', channelId, messages: res.data, reachedStart });
            }
          })
          .finally(() => dispatch({ type: 'history:loading', channelId, loading: false }));
      },

      async editMessage(messageId, content) {
        const socket = socketRef.current;
        if (!socket) return 'Sem conexão com o servidor.';
        const res = await socket.emitWithAck('message:edit', { messageId, content });
        if (!res.ok) return res.error;
        dispatch({ type: 'message:updated', message: res.data });
        return null;
      },

      async deleteMessage(messageId) {
        const socket = socketRef.current;
        if (!socket) return 'Sem conexão com o servidor.';
        // O estado é atualizado pelo evento `message:deleted`, que chega para todos que veem a conversa.
        const res = await socket.emitWithAck('message:delete', { messageId });
        return res.ok ? null : res.error;
      },

      createPoll: (targetId, poll) => ask((s) => s.timeout(10_000).emitWithAck('poll:create', { channelId: targetId, ...poll })),
      createRoulette: (targetId, roulette) => ask((s) => s.timeout(10_000).emitWithAck('roulette:create', { channelId: targetId, ...roulette })),
      votePoll: (messageId, optionId) => ask((s) => s.timeout(10_000).emitWithAck('poll:vote', { messageId, optionId })),
      closePoll: (messageId) => ask((s) => s.timeout(10_000).emitWithAck('poll:close', { messageId })),
      spinRoulette: (messageId) => ask((s) => s.timeout(10_000).emitWithAck('roulette:spin', { messageId })),

      requestLinkPreview(message) {
        const url = firstLink(message.content);
        const socket = socketRef.current;
        if (!url || !socket || previewsAskedRef.current.has(url)) return;
        previewsAskedRef.current.add(url);
        void socket
          .timeout(15_000)
          .emitWithAck('link:preview', { messageId: message.id, url })
          .then((res) => dispatch({ type: 'link:preview', url, preview: res.ok ? res.data : null }))
          .catch(() => previewsAskedRef.current.delete(url)); // sem resposta: tenta de novo quando a mensagem reaparecer
      },

      startReply(message) {
        dispatch({ type: 'reply:start', message });
      },

      cancelReply() {
        dispatch({ type: 'reply:cancel' });
      },

      async toggleReaction(messageId, emoji) {
        const socket = socketRef.current;
        if (!socket) return 'Sem conexão com o servidor.';
        try {
          const res = await socket.timeout(10_000).emitWithAck('reaction:toggle', { messageId, emoji });
          return res.ok ? null : res.error;
        } catch {
          return 'O servidor não respondeu. Tente de novo.';
        }
      },

      async sendMessage(channelId, content, attachmentIds = [], replyToId) {
        const socket = socketRef.current;
        if (!socket) return 'Sem conexão com o servidor.';
        lastTypingRef.current = { channelId: null, at: 0 };
        try {
          const res = await socket.timeout(10_000).emitWithAck('message:send', { channelId, content, attachmentIds, replyToId });
          if (!res.ok) return res.error;
          // Lista parada no passado: a mensagem enviada só aparece voltando ao presente.
          if (stateRef.current.detached[channelId]) void loadHistory(channelId);
          return null;
        } catch {
          return 'O servidor não respondeu. Tente de novo.';
        }
      },

      uploadImage(file, onProgress) {
        return uploadImage(identityRef.current.token, file, onProgress);
      },

      notifyTyping(channelId) {
        const now = Date.now();
        const last = lastTypingRef.current;
        if (last.channelId === channelId && now - last.at < TYPING_THROTTLE_MS) return;
        lastTypingRef.current = { channelId, at: now };
        socketRef.current?.emit('typing:start', { channelId });
      },

      joinVoice(channelId) {
        void joinVoice(channelId);
      },

      leaveVoice() {
        voiceRef.current?.leave();
        dispatch({ type: 'voice:self', patch: IDLE_VOICE });
      },

      screenStats(userId) {
        return voiceRef.current?.screenStats(userId) ?? Promise.resolve(null);
      },

      async streamPreview(userId) {
        const res = await socketRef.current?.emitWithAck('stream:preview:get', { userId });
        return res?.ok ? res.data.image : null;
      },

      async startScreenShare(options) {
        const voice = voiceRef.current;
        const socket = socketRef.current;
        if (!voice || !socket || !stateRef.current.myVoice.channelId) {
          return 'Entre em um canal de voz para compartilhar a tela.';
        }
        let stream: MediaStream;
        let audioFailed: boolean;
        let title: string;
        try {
          ({ stream, audioFailed, title } = await voice.startScreen(options));
        } catch (err) {
          return describeScreenError(err);
        }
        const res = await socket.emitWithAck('stream:start', { title });
        if (!res.ok) {
          voice.stopScreen();
          return res.error;
        }
        dispatch({ type: 'screen:mine', stream });
        if (audioFailed) {
          dispatch({ type: 'voice:self', patch: { error: 'O sistema não liberou o som: a tela está indo sem áudio.' } });
        }
        if (stateRef.current.me) dispatch({ type: 'stage:open', userId: stateRef.current.me.id });
        return null;
      },

      screenOptions() {
        return voiceRef.current?.screenOptions() ?? null;
      },

      updateScreenOptions(patch) {
        return voiceRef.current?.updateScreen(patch) ?? Promise.resolve(null);
      },

      async musicPlay(input, next = false) {
        const res = await socketRef.current?.emitWithAck('music:play', { input, next });
        if (!res) return { error: 'Sem conexão com o servidor.' };
        return res.ok ? { message: res.data.message } : { error: res.error };
      },

      async musicControl(request) {
        const res = await socketRef.current?.emitWithAck('music:control', request);
        return !res ? 'Sem conexão com o servidor.' : res.ok ? null : res.error;
      },

      stopScreenShare() {
        voiceRef.current?.stopScreen();
        socketRef.current?.emit('stream:stop');
        dispatch({ type: 'screen:mine', stream: null });
      },

      watchStream(userId) {
        void watchStream(userId).then((error) => {
          if (error) dispatch({ type: 'voice:self', patch: { error } });
        });
      },

      closeStage(userId) {
        dispatch({ type: 'stage:close', userId: userId ?? null });
      },

      focusStage(userId) {
        dispatch({ type: 'stage:focus', userId });
      },

      setStageLayout(layout) {
        dispatch({ type: 'stage:layout', layout });
      },

      toggleCamera() {
        void (async () => {
          const voice = voiceRef.current;
          const socket = socketRef.current;
          const { myVoice } = stateRef.current;
          if (!voice || !socket || !myVoice.channelId) return;
          if (myVoice.video) {
            voice.stopCamera();
            dispatch({ type: 'camera:mine', stream: null });
            socket.emit('voice:video', { enabled: false }, () => {});
            return;
          }
          let stream: MediaStream;
          try {
            stream = await voice.startCamera();
          } catch (err) {
            dispatch({ type: 'voice:self', patch: { error: describeCameraError(err) } });
            return;
          }
          const res = await socket.emitWithAck('voice:video', { enabled: true });
          if (!res.ok) {
            voice.stopCamera();
            dispatch({ type: 'voice:self', patch: { error: res.error } });
            return;
          }
          dispatch({ type: 'camera:mine', stream });
        })();
      },

      openCall(channelId) {
        void (async () => {
          if (await joinVoice(channelId)) {
            dispatch({ type: 'stage:close', userId: null });
            dispatch({ type: 'callView', open: true });
          }
        })();
      },

      closeCall() {
        dispatch({ type: 'callView', open: false });
      },

      async jumpToMessage(message) {
        const socket = socketRef.current;
        if (!socket) return 'Sem conexão com o servidor.';
        const res = await socket.emitWithAck('message:context', { messageId: message.id });
        if (!res.ok) return res.error;
        const { channelId, messages, reachedStart, reachedEnd } = res.data;
        dispatch({ type: 'messages:context', channelId, messages, reachedStart, reachedEnd, focusId: message.id });

        const { directs, snapshot, activeSpaceId } = stateRef.current;
        if (directs[channelId]) {
          dispatch({ type: 'dm:select', conversationId: channelId });
          return null;
        }
        if (snapshot?.channels.some((c) => c.id === channelId)) {
          openChannel(snapshot, channelId, { keepHistory: true });
          return null;
        }
        // Canal de outro espaço (a busca é por espaço, mas o espaço pode ter mudado no meio).
        const spaceId = activeSpaceId;
        if (spaceId) await selectSpace(spaceId, channelId);
        return null;
      },

      loadNewer(channelId) {
        const { detached, loadingOlder, messages } = stateRef.current;
        const newest = messages[channelId]?.at(-1);
        const socket = socketRef.current;
        if (!socket || !newest || !detached[channelId] || loadingOlder[channelId]) return;
        dispatch({ type: 'history:loading', channelId, loading: true });
        void socket
          .emitWithAck('channel:history', { channelId, after: newest.id, limit: HISTORY_PAGE_SIZE })
          .then((res) => {
            if (res.ok) {
              const reachedEnd = res.data.length < HISTORY_PAGE_SIZE;
              dispatch({ type: 'messages:newer', channelId, messages: res.data, reachedEnd });
            }
          })
          .finally(() => dispatch({ type: 'history:loading', channelId, loading: false }));
      },

      jumpToPresent(channelId) {
        void loadHistory(channelId);
      },

      focusDone() {
        dispatch({ type: 'focus:clear' });
      },

      async search(req) {
        const socket = socketRef.current;
        if (!socket) return { ok: false, error: 'Sem conexão com o servidor.' };
        try {
          return await socket.timeout(10_000).emitWithAck('message:search', req);
        } catch {
          return { ok: false, error: 'O servidor não respondeu. Tente de novo.' };
        }
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
    const socket = createSocket(identity.token);

    /** Notificação do sistema para uma mensagem que merece uma, com a janela fora de vista. */
    const notifyMessage = (message: Message) => {
      const s = stateRef.current;
      const prefs = notificationPrefsRef.current;
      if (!prefs.enabled || !s.me || s.me.status === 'dnd' || isWindowActive()) return;
      const direct = s.directs[message.channelId];
      const channel = direct ? null : s.snapshot?.channels.find((c) => c.id === message.channelId);
      if (!direct && !channel) return;
      const toast = toastFor({
        me: s.me.id,
        message,
        nameOf: (id) => (s.users[id] ? displayNameOf(s.snapshot, s.users, id) : null),
        channelName: channel?.name ?? null,
        authorIsBot: s.users[message.authorId]?.isBot === true,
        preview: prefs.preview,
      });
      if (!toast) return;
      showToast(toast, () => {
        if (direct) actions.selectDirect(message.channelId);
        else void actions.jumpToMessage(message);
      });
    };

    /** Menção num espaço que não está aberto: as mensagens de lá não chegam, só o contador, então o aviso é genérico. */
    const notifyMentionElsewhere = (mention: MentionCount) => {
      const s = stateRef.current;
      const prefs = notificationPrefsRef.current;
      if (!prefs.enabled || !s.me || s.me.status === 'dnd' || isWindowActive()) return;
      if (mention.spaceId === s.activeSpaceId || mention.count <= (s.mentions[mention.channelId]?.count ?? 0)) return;
      const space = s.spaces.find((sp) => sp.id === mention.spaceId);
      showToast({ title: space?.name ?? 'Coreto', body: 'Você foi mencionado', tag: mention.channelId }, () => {
        actions.selectSpace(mention.spaceId);
      });
    };

    const voice = new VoiceManager(socket, {
      onSpeaking: (speaking) => dispatch({ type: 'speaking', userIds: [...speaking] }),
      onQuality: (quality) => dispatch({ type: 'quality', quality }),
      onRemoteScreen: (userId, stream) => dispatch({ type: 'screen:remote', userId, stream }),
      onRemoteCamera: (userId, stream) => dispatch({ type: 'camera:remote', userId, stream }),
      onScreenEnded: () => actions.stopScreenShare(),
      isBot: (userId) => stateRef.current.users[userId]?.isBot === true,
    });
    socketRef.current = socket;
    voiceRef.current = voice;
    firstSessionRef.current = true;

    socket.on('unread:bump', ({ channelId, spaceId }) => dispatch({ type: 'unread:bump', channelId, spaceId }));
    socket.on('session:ready', ({ user, spaces, directs, directUsers, mentions, unread }) => {
      dispatch({ type: 'session', user, spaces, directs, directUsers, mentions, unread });
      // Na primeira conexão abre o primeiro espaço; nas reconexões, reabre o atual.
      const target = firstSessionRef.current ? (spaces[0]?.id ?? null) : stateRef.current.activeSpaceId;
      firstSessionRef.current = false;
      actions.selectSpace(target);
    });
    socket.on('space:created', (space) => dispatch({ type: 'space:created', space }));
    socket.on('space:updated', (space) => dispatch({ type: 'space:updated', space }));
    socket.on('space:deleted', ({ spaceId }) => {
      const before = stateRef.current;
      dispatch({ type: 'space:deleted', spaceId });
      // Quem estava no espaço excluído vai para o primeiro que sobrou (ou para as mensagens diretas).
      if (before.activeSpaceId === spaceId) {
        actions.selectSpace(before.spaces.find((s) => s.id !== spaceId)?.id ?? null);
      }
    });
    socket.on('channel:created', (payload) => dispatch({ type: 'channel:created', payload }));
    socket.on('channel:updated', (channel) => dispatch({ type: 'channel:updated', channel }));
    socket.on('channel:deleted', ({ spaceId, channelId }) => {
      const before = stateRef.current;
      dispatch({ type: 'channel:deleted', spaceId, channelId });
      // Quem estava lendo o canal excluído vai para o primeiro canal de texto que sobrou.
      if (before.activeSpaceId === spaceId && before.activeChannelBySpace[spaceId] === channelId) {
        const next = before.snapshot?.channels.find((c) => c.kind === 'text' && c.id !== channelId);
        if (next) actions.selectChannel(next.id);
      }
    });
    socket.on('dm:upsert', (payload) => dispatch({ type: 'dm:upsert', payload }));
    socket.on('message:new', (message) => {
      dispatch({ type: 'message:new', message });
      notifyMessage(message);
    });
    socket.on('message:updated', (message) => dispatch({ type: 'message:updated', message }));
    socket.on('poll:updated', ({ channelId, messageId, poll }) => dispatch({ type: 'poll:updated', channelId, messageId, poll }));
    socket.on('roulette:spun', ({ channelId, messageId, roulette }) => {
      dispatch({ type: 'roulette:spun', channelId, messageId, roulette });
      // Depois que a roda para, a mensagem volta a ser um cartão comum (sem animar de novo se sair e voltar da tela).
      setTimeout(() => dispatch({ type: 'roulette:settled', messageId }), ROULETTE_SPIN_MS + 1500);
    });
    socket.on('message:reactions', ({ channelId, messageId, reactions }) =>
      dispatch({ type: 'message:reactions', channelId, messageId, reactions }),
    );
    socket.on('message:deleted', ({ channelId, messageId }) => dispatch({ type: 'message:deleted', channelId, messageId }));
    socket.on('typing', ({ channelId, userId }) =>
      dispatch({ type: 'typing', channelId, userId, until: Date.now() + TYPING_TTL_MS }),
    );
    socket.on('mentions:update', (mention) => {
      notifyMentionElsewhere(mention);
      dispatch({ type: 'mentions:update', mention });
    });
    socket.on('presence:update', ({ userId, status }) => dispatch({ type: 'presence', userId, status }));
    socket.on('member:joined', ({ member, user }) => dispatch({ type: 'member:joined', member, user }));
    socket.on('voice:update', ({ channelId, participants }) =>
      dispatch({ type: 'voice:update', channelId, participants }),
    );
    socket.on('music:state', (musicState) => dispatch({ type: 'music:state', state: musicState }));
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
    socket.on('connect_error', (err: Error & { data?: { code?: string } }) => {
      if (err.data?.code === INVALID_SESSION) {
        onSessionInvalidRef.current();
        return;
      }
      dispatch({ type: 'connection', connection: 'disconnected', error: err.message });
    });

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

  // Canal aberto com menções pendentes: elas acabaram de ser vistas.
  const openChannelId = state.snapshot ? state.activeChannelBySpace[state.snapshot.space.id] : undefined;
  const openChannelMentions = openChannelId && state.activeSpaceId ? (state.mentions[openChannelId]?.count ?? 0) : 0;
  useEffect(() => {
    if (!openChannelId || openChannelMentions === 0) return;
    socketRef.current?.emit('mentions:ack', { channelId: openChannelId });
    dispatch({ type: 'mentions:update', mention: { ...stateRef.current.mentions[openChannelId], count: 0 } });
  }, [openChannelId, openChannelMentions]);

  // Lendo o canal ou a conversa (aberto, com o chat à vista e a janela em primeiro plano), o que chega e o que
  // estava pendente já foi lido: zera o contador aqui e avisa o servidor, que guarda até onde você leu.
  const windowActive = useWindowActive();
  const openPlaceId = state.activeSpaceId === null ? state.activeDirectId : openChannelId;
  const openPlaceUnread = openPlaceId ? (state.unread[openPlaceId]?.count ?? 0) : 0;
  const chatVisible = state.stages.length === 0 && !(state.callView && state.myVoice.channelId);
  useEffect(() => {
    if (!openPlaceId || openPlaceUnread === 0 || !windowActive || !chatVisible) return;
    socketRef.current?.emit('read:mark', { channelId: openPlaceId });
    dispatch({ type: 'unread:clear', channelId: openPlaceId });
  }, [openPlaceId, openPlaceUnread, windowActive, chatVisible]);

  // Configurações de voz e vídeo valem na hora, inclusive no meio da chamada.
  const { settings } = useSettings();
  notificationPrefsRef.current = settings.notifications;

  // O título da janela (e da barra de tarefas) mostra quantas mensagens não lidas há.
  const totalUnread = Object.values(state.unread).reduce((sum, entry) => sum + entry.count, 0);
  useEffect(() => {
    document.title = totalUnread > 0 ? `(${totalUnread > 99 ? '99+' : totalUnread}) Coreto` : 'Coreto';
  }, [totalUnread]);
  useEffect(() => {
    voiceRef.current
      ?.applyPrefs(settings.voice)
      .then(({ camera }) => camera && dispatch({ type: 'camera:mine', stream: camera }))
      .catch((err: unknown) => dispatch({ type: 'voice:self', patch: { error: describeMediaError(err) } }));
  }, [settings.voice, identity]);

  // Sua tela vai só para quem está assistindo, segundo a lista da sala.
  const myRoom = state.myVoice.channelId ? state.voice[state.myVoice.channelId] : undefined;
  const myId = state.me?.id;
  useEffect(() => {
    const viewers = (myRoom ?? []).filter((p) => p.watching.includes(myId ?? '')).map((p) => p.userId);
    voiceRef.current?.setScreenViewers(viewers);
  }, [myRoom, myId]);

  // O servidor diz que você assiste a alguém, mas o palco não mostra essa pessoa: pare de receber só dela.
  const watchingOnServer = useMemo(() => myRoom?.find((p) => p.userId === myId)?.watching ?? [], [myRoom, myId]);
  const watchingKey = watchingOnServer.join(',');
  useEffect(() => {
    for (const id of watchingOnServer) if (!state.stages.includes(id)) socketRef.current?.emit('stream:unwatch', { userId: id });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `watchingKey` representa a lista
  }, [watchingKey, state.stages]);

  // Com servidor de mídia, a imagem de quem você assiste chega de lá: avisa de quem são.
  useEffect(() => {
    voiceRef.current?.setWatching(watchingOnServer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `watchingKey` representa a lista
  }, [watchingKey]);

  const value = useMemo(() => ({ state, actions }), [state, actions]);
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime(): RealtimeContextValue {
  const value = useContext(RealtimeContext);
  if (!value) throw new Error('useRealtime precisa estar dentro de <RealtimeProvider>.');
  return value;
}

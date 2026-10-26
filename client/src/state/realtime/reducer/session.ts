// Conexão, sessão, espaços, canais, conversas diretas, navegação, presença, menções e não lidas.

import type { Id, MentionCount, UnreadCount, VoiceParticipant } from '@shared/models';
import type { RealtimeState } from '../state';
import type { ActionOf } from '../types';
import { withoutKey } from './helpers';

export function connection(state: RealtimeState, action: ActionOf<'connection'>): RealtimeState {
  return { ...state, connection: action.connection, connectionError: action.error ?? null };
}

export function session(state: RealtimeState, action: ActionOf<'session'>): RealtimeState {
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

export function spaceCreated(state: RealtimeState, action: ActionOf<'space:created'>): RealtimeState {
  if (state.spaces.some((s) => s.id === action.space.id)) return state;
  return { ...state, spaces: [...state.spaces, action.space] };
}

export function spaceUpdated(state: RealtimeState, action: ActionOf<'space:updated'>): RealtimeState {
  return {
    ...state,
    spaces: state.spaces.map((s) => (s.id === action.space.id ? action.space : s)),
    snapshot: state.snapshot?.space.id === action.space.id ? { ...state.snapshot, space: action.space } : state.snapshot,
  };
}

export function spaceDeleted(state: RealtimeState, action: ActionOf<'space:deleted'>): RealtimeState {
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

export function channelCreated(state: RealtimeState, action: ActionOf<'channel:created'>): RealtimeState {
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

export function channelUpdated(state: RealtimeState, action: ActionOf<'channel:updated'>): RealtimeState {
  const snapshot = state.snapshot;
  if (!snapshot || !snapshot.channels.some((c) => c.id === action.channel.id)) return state;
  const channels = snapshot.channels
    .map((c) => (c.id === action.channel.id ? action.channel : c))
    .sort((a, b) => a.position - b.position);
  return { ...state, snapshot: { ...snapshot, channels } };
}

export function channelDeleted(state: RealtimeState, action: ActionOf<'channel:deleted'>): RealtimeState {
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

export function dmUpsert(state: RealtimeState, action: ActionOf<'dm:upsert'>): RealtimeState {
  const { conversation, users: participants } = action.payload;
  const users = { ...state.users };
  for (const user of participants) users[user.id] = user;
  return { ...state, users, directs: { ...state.directs, [conversation.id]: conversation } };
}

export function dmSelect(state: RealtimeState, action: ActionOf<'dm:select'>): RealtimeState {
  return {
    ...state,
    replyingTo: null,
    stages: [],
    focusedStage: null,
    callView: false,
    activeSpaceId: null,
    activeDirectId: action.conversationId,
  };
}

export function unreadBump(state: RealtimeState, action: ActionOf<'unread:bump'>): RealtimeState {
  const current = state.unread[action.channelId];
  return {
    ...state,
    unread: {
      ...state.unread,
      [action.channelId]: { channelId: action.channelId, spaceId: action.spaceId, count: (current?.count ?? 0) + 1 },
    },
  };
}

export function unreadClear(state: RealtimeState, action: ActionOf<'unread:clear'>): RealtimeState {
  return state.unread[action.channelId] ? { ...state, unread: withoutKey(state.unread, action.channelId) } : state;
}

export function spaceSelect(state: RealtimeState, action: ActionOf<'space:select'>): RealtimeState {
  return {
    ...state,
    replyingTo: null,
    stages: [],
    focusedStage: null,
    callView: false,
    activeSpaceId: action.spaceId,
    snapshot: state.snapshot?.space.id === action.spaceId ? state.snapshot : null,
  };
}

export function spaceSnapshot(state: RealtimeState, action: ActionOf<'space:snapshot'>): RealtimeState {
  if (action.snapshot.space.id !== state.activeSpaceId) return state; // resposta atrasada de outro espaço
  const users = { ...state.users };
  for (const user of action.snapshot.users) users[user.id] = user;
  const voice: Record<Id, VoiceParticipant[]> = {};
  for (const p of action.snapshot.voice) (voice[p.channelId] ??= []).push(p);
  return { ...state, snapshot: action.snapshot, users, voice };
}

export function channelSelect(state: RealtimeState, action: ActionOf<'channel:select'>): RealtimeState {
  return {
    ...state,
    replyingTo: null,
    stages: [],
    focusedStage: null,
    callView: false,
    activeChannelBySpace: { ...state.activeChannelBySpace, [action.spaceId]: action.channelId },
  };
}

export function presence(state: RealtimeState, action: ActionOf<'presence'>): RealtimeState {
  const user = state.users[action.userId];
  if (!user) return state;
  const updated = { ...user, status: action.status };
  return {
    ...state,
    users: { ...state.users, [action.userId]: updated },
    me: state.me?.id === action.userId ? updated : state.me,
  };
}

export function memberJoined(state: RealtimeState, action: ActionOf<'member:joined'>): RealtimeState {
  const users = { ...state.users, [action.user.id]: action.user };
  const snapshot = state.snapshot;
  if (!snapshot || snapshot.space.id !== action.member.spaceId) return { ...state, users };
  if (snapshot.members.some((m) => m.userId === action.member.userId)) return { ...state, users };
  return { ...state, users, snapshot: { ...snapshot, members: [...snapshot.members, action.member] } };
}

export function mentionsUpdate(state: RealtimeState, action: ActionOf<'mentions:update'>): RealtimeState {
  const { mention } = action;
  return {
    ...state,
    mentions:
      mention.count > 0
        ? { ...state.mentions, [mention.channelId]: mention }
        : withoutKey(state.mentions, mention.channelId),
  };
}

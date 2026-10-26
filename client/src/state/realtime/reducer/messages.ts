// Mensagens: histórico, novas, edição, exclusão, reações, fixadas, enquetes, roletas, pré-visualização de links,
// resposta em andamento e aviso de digitação.

import { deletedReply, replyPreviewOf } from '@shared/reply';
import type { RealtimeState } from '../state';
import type { ActionOf } from '../types';
import { withoutKey } from './helpers';

export function messagesHistory(state: RealtimeState, action: ActionOf<'messages:history'>): RealtimeState {
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

export function messagesNewer(state: RealtimeState, action: ActionOf<'messages:newer'>): RealtimeState {
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

export function messagesContext(state: RealtimeState, action: ActionOf<'messages:context'>): RealtimeState {
  return {
    ...state,
    messages: { ...state.messages, [action.channelId]: action.messages },
    historyComplete: action.reachedStart
      ? { ...state.historyComplete, [action.channelId]: true }
      : withoutKey(state.historyComplete, action.channelId),
    detached: action.reachedEnd ? withoutKey(state.detached, action.channelId) : { ...state.detached, [action.channelId]: true },
    focus: { channelId: action.channelId, messageId: action.focusId },
  };
}

export function focusClear(state: RealtimeState): RealtimeState {
  return { ...state, focus: null };
}

export function historyLoading(state: RealtimeState, action: ActionOf<'history:loading'>): RealtimeState {
  return {
    ...state,
    loadingOlder: action.loading
      ? { ...state.loadingOlder, [action.channelId]: true }
      : withoutKey(state.loadingOlder, action.channelId),
  };
}

export function messageUpdated(state: RealtimeState, action: ActionOf<'message:updated'>): RealtimeState {
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

export function messageDeleted(state: RealtimeState, action: ActionOf<'message:deleted'>): RealtimeState {
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

export function messageReactions(state: RealtimeState, action: ActionOf<'message:reactions'>): RealtimeState {
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

export function messagePinned(state: RealtimeState, action: ActionOf<'message:pinned'>): RealtimeState {
  const list = state.messages[action.channelId];
  if (!list?.some((m) => m.id === action.messageId)) return state;
  return {
    ...state,
    messages: {
      ...state.messages,
      [action.channelId]: list.map((m) =>
        m.id === action.messageId ? { ...m, pinnedAt: action.pinnedAt, pinnedById: action.pinnedById } : m,
      ),
    },
  };
}

export function pollUpdated(state: RealtimeState, action: ActionOf<'poll:updated'>): RealtimeState {
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

export function rouletteSpun(state: RealtimeState, action: ActionOf<'roulette:spun'>): RealtimeState {
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

export function rouletteSettled(state: RealtimeState, action: ActionOf<'roulette:settled'>): RealtimeState {
  return state.freshSpins[action.messageId] ? { ...state, freshSpins: withoutKey(state.freshSpins, action.messageId) } : state;
}

export function linkPreview(state: RealtimeState, action: ActionOf<'link:preview'>): RealtimeState {
  return { ...state, linkPreviews: { ...state.linkPreviews, [action.url]: action.preview } };
}

export function replyStart(state: RealtimeState, action: ActionOf<'reply:start'>): RealtimeState {
  return { ...state, replyingTo: action.message };
}

export function replyCancel(state: RealtimeState): RealtimeState {
  return state.replyingTo ? { ...state, replyingTo: null } : state;
}

export function messageNew(state: RealtimeState, action: ActionOf<'message:new'>): RealtimeState {
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

export function typing(state: RealtimeState, action: ActionOf<'typing'>): RealtimeState {
  return {
    ...state,
    typing: {
      ...state.typing,
      [action.channelId]: { ...state.typing[action.channelId], [action.userId]: action.until },
    },
  };
}

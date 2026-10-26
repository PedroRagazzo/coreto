// Mensagens: enviar, editar, apagar, reagir, anexos, histórico, busca, fixadas, enquetes, roletas e links.

import { firstLink } from '@shared/links';
import type { Id } from '@shared/models';
import { HISTORY_PAGE_SIZE } from '@shared/protocol';
import { uploadFile } from '../../../lib/uploads';
import { ask, type ActionContext } from '../context';
import type { RealtimeActions } from '../types';

const TYPING_THROTTLE_MS = 3_000;

export function createMessageActions(ctx: ActionContext, loadHistory: (channelId: Id) => Promise<void>) {
  const { dispatch, stateRef, socketRef, identityRef, lastTypingRef, previewsAskedRef } = ctx;

  return {
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

    pinMessage: (messageId, pinned) => ask(ctx, (s) => s.timeout(10_000).emitWithAck('message:pin', { messageId, pinned })),

    async loadPins(channelId) {
      const socket = socketRef.current;
      if (!socket) return { error: 'Sem conexão com o servidor.' };
      try {
        const res = await socket.timeout(10_000).emitWithAck('pins:list', { channelId });
        return res.ok ? { messages: res.data } : { error: res.error };
      } catch {
        return { error: 'O servidor não respondeu. Tente de novo.' };
      }
    },

    createPoll: (targetId, poll) => ask(ctx, (s) => s.timeout(10_000).emitWithAck('poll:create', { channelId: targetId, ...poll })),
    createRoulette: (targetId, roulette) => ask(ctx, (s) => s.timeout(10_000).emitWithAck('roulette:create', { channelId: targetId, ...roulette })),
    votePoll: (messageId, optionId) => ask(ctx, (s) => s.timeout(10_000).emitWithAck('poll:vote', { messageId, optionId })),
    closePoll: (messageId) => ask(ctx, (s) => s.timeout(10_000).emitWithAck('poll:close', { messageId })),
    spinRoulette: (messageId) => ask(ctx, (s) => s.timeout(10_000).emitWithAck('roulette:spin', { messageId })),

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

    uploadFile(file, onProgress) {
      return uploadFile(identityRef.current.token, file, onProgress);
    },

    notifyTyping(channelId) {
      const now = Date.now();
      const last = lastTypingRef.current;
      if (last.channelId === channelId && now - last.at < TYPING_THROTTLE_MS) return;
      lastTypingRef.current = { channelId, at: now };
      socketRef.current?.emit('typing:start', { channelId });
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
  } satisfies Partial<RealtimeActions>;
}

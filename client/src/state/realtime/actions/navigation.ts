// Espaços, canais, conversas diretas e presença: abrir, criar, renomear, excluir e pular para uma mensagem.

import type { Id, SpaceSnapshot } from '@shared/models';
import { HISTORY_PAGE_SIZE } from '@shared/protocol';
import type { ActionContext } from '../context';
import type { RealtimeActions } from '../types';

export function createNavigation({ dispatch, stateRef, socketRef }: ActionContext) {
  /** A página mais recente de um canal ou conversa. */
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
    const target = res.data.channels.find((c) => c.id === remembered) ?? res.data.channels.find((c) => c.kind === 'text');
    if (target) openChannel(res.data, target.id);
  };

  const actions = {
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
        openChannel({ ...snapshot, channels: [...snapshot.channels, res.data.channel] }, res.data.channel.id);
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

    focusDone() {
      dispatch({ type: 'focus:clear' });
    },

    setPresence(status) {
      const me = stateRef.current.me;
      if (!me) return;
      dispatch({ type: 'presence', userId: me.id, status });
      socketRef.current?.emit('presence:set', status);
    },
  } satisfies Partial<RealtimeActions>;

  return { actions, loadHistory };
}

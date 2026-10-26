// A ligação com o servidor: abre o socket e a voz da sessão, transforma cada evento do servidor numa ação do reducer
// (ou numa notificação do sistema) e devolve a função que desfaz tudo.

import type { Message, MentionCount } from '@shared/models';
import { toastFor } from '@shared/notify';
import { ROULETTE_SPIN_MS } from '@shared/polls';
import { INVALID_SESSION } from '@shared/protocol';
import type { MutableRefObject } from 'react';
import { isWindowActive } from '../../lib/focus';
import { showToast } from '../../lib/notifications';
import { createSocket } from '../../lib/socket';
import type { NotificationPrefs } from '../../lib/settings';
import { VoiceManager } from '../../lib/voice';
import { displayNameOf } from '../selectors';
import type { ActionContext } from './context';
import { IDLE_VOICE } from './state';
import type { RealtimeActions } from './types';

const TYPING_TTL_MS = 6_000;

export interface SocketOptions {
  token: string;
  ctx: ActionContext;
  actions: RealtimeActions;
  /** As preferências de notificação valem na hora, sem refazer a conexão com o servidor. */
  notificationPrefsRef: MutableRefObject<NotificationPrefs>;
  /** Na primeira conexão abre o primeiro espaço; nas reconexões, reabre o atual. */
  firstSessionRef: MutableRefObject<boolean>;
  /** O servidor recusou a sessão guardada: é preciso entrar de novo. */
  onSessionInvalidRef: MutableRefObject<() => void>;
}

export function connectSocket({ token, ctx, actions, notificationPrefsRef, firstSessionRef, onSessionInvalidRef }: SocketOptions): () => void {
  const { dispatch, stateRef, socketRef, voiceRef } = ctx;
  const socket = createSocket(token);

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
  socket.on('sounds:updated', ({ spaceId, clips }) => dispatch({ type: 'sounds:set', spaceId, clips }));
  socket.on('message:pinned', ({ channelId, messageId, pinnedAt, pinnedById }) =>
    dispatch({ type: 'message:pinned', channelId, messageId, pinnedAt, pinnedById }),
  );
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
  socket.on('voice:update', ({ channelId, participants }) => dispatch({ type: 'voice:update', channelId, participants }));
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
}

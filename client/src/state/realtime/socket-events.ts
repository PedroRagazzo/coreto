// A ligação com o servidor: abre o socket e a voz da sessão, transforma cada evento do servidor numa ação do reducer
// (ou numa notificação do sistema) e devolve a função que desfaz tudo.

import type { Message, MentionCount } from '@shared/models';
import { toastFor } from '@shared/notify';
import { ROULETTE_SPIN_MS } from '@shared/polls';
import { INVALID_SESSION } from '@shared/protocol';
import type { MutableRefObject } from 'react';
import { alreadyReloadedFor, hasUnsentText, liveBundle, markReloadedFor, runningBundle } from '../../lib/appVersion';
import { forgetCall, recallCall, rememberCall } from '../../lib/callMemory';
import { desktop } from '../../lib/desktop';
import { isWindowActive } from '../../lib/focus';
import { showToast } from '../../lib/notifications';
import { createSocket } from '../../lib/socket';
import { recordBack, recordDrop } from '../../lib/dropLog';
import type { NotificationPrefs } from '../../lib/settings';
import { VoiceManager } from '../../lib/voice';
import { displayNameOf } from '../selectors';
import type { ActionContext } from './context';
import { IDLE_VOICE, type ResumableCall } from './state';
import type { RealtimeActions } from './types';

const TYPING_TTL_MS = 6_000;
/** Depois de quanto tempo sem conexão (ou sem a página aberta) a chamada não volta mais sozinha. */
const RESUME_CALL_MS = 300_000;
/** De quanto em quanto tempo a aba confere se o site ganhou versão nova. */
const UPDATE_CHECK_MS = 60_000;
/** Com texto escrito e não enviado, a atualização espera até esse tempo para não perdê-lo. */
const DRAFT_WAIT_MS = 180_000;

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
  /** A chamada que caiu junto com a conexão, para voltar a ela quando a conexão voltar. */
  // Também vale para a chamada em que a pessoa estava quando recarregou a página (F5, Ctrl+F5 ou atualização automática).
  let resumable: (ResumableCall & { droppedAt: number }) | null = recallCall(RESUME_CALL_MS);

  // A aba confere se o servidor já entrega uma versão nova do site e, se sim, recarrega sozinha. A chamada em que a pessoa
  // estava volta sozinha em seguida (ver `saveCallForReload`).
  let updateSeenAt = 0;
  let checking = false;
  const checkForUpdate = async () => {
    if (checking) return;
    checking = true;
    try {
      const running = runningBundle();
      if (!running) return;
      const live = await liveBundle();
      if (!live || live === running) {
        updateSeenAt = 0;
        return;
      }
      if (alreadyReloadedFor(live)) return;
      updateSeenAt ||= Date.now();
      if (hasUnsentText() && Date.now() - updateSeenAt < DRAFT_WAIT_MS) return;
      markReloadedFor(live);
      window.location.reload();
    } finally {
      checking = false;
    }
  };
  const updateTimer = setInterval(() => void checkForUpdate(), UPDATE_CHECK_MS);
  const onVisible = () => {
    if (document.visibilityState === 'visible') void checkForUpdate();
  };
  document.addEventListener('visibilitychange', onVisible);

  /** Ao sair da página (recarregar, atualizar), guarda a chamada para voltar a ela quando a página abrir de novo. */
  const saveCallForReload = () => {
    const { myVoice } = stateRef.current;
    if (myVoice.channelId && myVoice.spaceId) {
      rememberCall({
        channelId: myVoice.channelId,
        spaceId: myVoice.spaceId,
        muted: myVoice.muted,
        deafened: myVoice.deafened,
        streaming: myVoice.streaming,
      });
    } else if (resumable) rememberCall(resumable, resumable.droppedAt);
    else forgetCall();
  };
  window.addEventListener('pagehide', saveCallForReload);

  socket.on('unread:bump', ({ channelId, spaceId }) => dispatch({ type: 'unread:bump', channelId, spaceId }));
  socket.on('session:ready', ({ user, spaces, directs, directUsers, mentions, unread, superAdmin }) => {
    dispatch({ type: 'session', user, spaces, directs, directUsers, mentions, unread, superAdmin });
    recordBack();
    // Na primeira conexão abre o primeiro espaço; nas reconexões, reabre o atual.
    // Ao recarregar no meio de uma chamada, abre o espaço dela.
    const callSpace = resumable && spaces.some((s) => s.id === resumable?.spaceId) ? resumable.spaceId : null;
    const target = firstSessionRef.current ? (callSpace ?? spaces[0]?.id ?? null) : stateRef.current.activeSpaceId;
    firstSessionRef.current = false;
    actions.selectSpace(target);

    // Reconectou depois de cair no meio de uma chamada, ou recarregou a página nela (o servidor reiniciou numa atualização,
    // a pessoa apertou Ctrl+F5): volta para a chamada.
    const call = resumable;
    resumable = null;
    forgetCall();
    void checkForUpdate();
    const { myVoice } = stateRef.current;
    if (call && Date.now() - call.droppedAt <= RESUME_CALL_MS && !myVoice.channelId && !myVoice.connecting) {
      void actions.rejoinVoice(call).then(async (joined) => {
        // Quem transmitia no app de desktop volta ao ar sozinho, com a mesma tela ou janela de antes. (Um pouco de espera para o
        // estado da chamada chegar à tela; no navegador isso não existe e fica o botão "Retomar transmissão".)
        if (!joined || !call.streaming || !desktop?.resumeCapture) return;
        await new Promise((resolve) => setTimeout(resolve, 400));
        await desktop.resumeCapture().catch(() => false);
      });
    }
  });
  socket.on('account:deleted', ({ userId }) => dispatch({ type: 'account:deleted', userId }));
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
  socket.on('member:updated', ({ member }) => dispatch({ type: 'member:updated', member }));
  socket.on('voice:update', ({ channelId, participants }) => dispatch({ type: 'voice:update', channelId, participants }));
  socket.on('music:state', (musicState) => dispatch({ type: 'music:state', state: musicState }));
  socket.on('voice:ended', ({ reason }) => {
    voice.teardown();
    dispatch({ type: 'voice:self', patch: { ...IDLE_VOICE, error: reason } });
  });
  socket.on('disconnect', (reason) => {
    // Queda de conexão (servidor reiniciando, rede): guarda a chamada para voltar a ela. Sair do app ou ser desconectado pelo
    // servidor de propósito (conta excluída, sessão inválida) não retoma nada.
    const { myVoice } = stateRef.current;
    const dropped = reason !== 'io client disconnect' && reason !== 'io server disconnect';
    if (dropped) recordDrop(reason, Boolean(myVoice.channelId));
    resumable =
      dropped && myVoice.channelId && myVoice.spaceId
        ? { channelId: myVoice.channelId, spaceId: myVoice.spaceId, muted: myVoice.muted, deafened: myVoice.deafened, streaming: myVoice.streaming, droppedAt: Date.now() }
        : null;
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
    clearInterval(updateTimer);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('pagehide', saveCallForReload);
    voice.leave();
    socket.removeAllListeners();
    socket.disconnect();
    socketRef.current = null;
    voiceRef.current = null;
  };
}

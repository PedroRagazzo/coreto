// Efeitos que acompanham o estado: o que já foi lido, o título da janela e a voz.

import { useEffect, useMemo } from 'react';
import type { Identity } from '../../lib/identity';
import { useWindowActive } from '../../lib/focus';
import type { VoicePrefs } from '../../lib/settings';
import { describeMediaError } from '../../lib/voice';
import type { ActionContext } from './context';
import type { RealtimeState } from './state';

/**
 * Menções e mensagens não lidas: o canal aberto com menções pendentes as acaba de ver, e lendo o canal ou a conversa
 * (aberto, com o chat à vista e a janela em primeiro plano) o que chega e o que estava pendente já foi lido.
 */
export function useReadTracking(state: RealtimeState, { dispatch, stateRef, socketRef }: ActionContext): void {
  // Canal aberto com menções pendentes: elas acabaram de ser vistas.
  const openChannelId = state.snapshot ? state.activeChannelBySpace[state.snapshot.space.id] : undefined;
  const openChannelMentions = openChannelId && state.activeSpaceId ? (state.mentions[openChannelId]?.count ?? 0) : 0;
  useEffect(() => {
    if (!openChannelId || openChannelMentions === 0) return;
    socketRef.current?.emit('mentions:ack', { channelId: openChannelId });
    dispatch({ type: 'mentions:update', mention: { ...stateRef.current.mentions[openChannelId], count: 0 } });
  }, [openChannelId, openChannelMentions, dispatch, stateRef, socketRef]);

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
  }, [openPlaceId, openPlaceUnread, windowActive, chatVisible, dispatch, socketRef]);
}

/** O título da janela (e da barra de tarefas) mostra quantas mensagens não lidas há. */
export function useUnreadTitle(state: RealtimeState): void {
  const totalUnread = Object.values(state.unread).reduce((sum, entry) => sum + entry.count, 0);
  useEffect(() => {
    document.title = totalUnread > 0 ? `(${totalUnread > 99 ? '99+' : totalUnread}) Coreto` : 'Coreto';
  }, [totalUnread]);
}

/** Mantém a voz em dia com as configurações e com a lista da sala (quem assiste a quem). */
export function useVoiceSync(state: RealtimeState, { dispatch, socketRef, voiceRef }: ActionContext, voicePrefs: VoicePrefs, identity: Identity): void {
  // Configurações de voz e vídeo valem na hora, inclusive no meio da chamada.
  useEffect(() => {
    voiceRef.current
      ?.applyPrefs(voicePrefs)
      .then(({ camera }) => camera && dispatch({ type: 'camera:mine', stream: camera }))
      .catch((err: unknown) => dispatch({ type: 'voice:self', patch: { error: describeMediaError(err) } }));
  }, [voicePrefs, identity, dispatch, voiceRef]);

  // Sua tela vai só para quem está assistindo, segundo a lista da sala.
  const myRoom = state.myVoice.channelId ? state.voice[state.myVoice.channelId] : undefined;
  const myId = state.me?.id;
  useEffect(() => {
    const viewers = (myRoom ?? []).filter((p) => p.watching.includes(myId ?? '')).map((p) => p.userId);
    voiceRef.current?.setScreenViewers(viewers);
  }, [myRoom, myId, voiceRef]);

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
}

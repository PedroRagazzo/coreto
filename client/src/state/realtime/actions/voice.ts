// Chamada de voz: entrar e sair, mutar, transmissões de tela, câmera, música e quadro de som.

import { hasPermission, Permission } from '@shared/permissions';
import type { Id } from '@shared/models';
import { checkSoundFile, fetchSound, uploadSound } from '../../../lib/soundboard';
import { describeCameraError, describeMediaError, describeScreenError } from '../../../lib/voice';
import { ask, type ActionContext } from '../context';
import { IDLE_VOICE } from '../state';
import type { RealtimeActions } from '../types';

export function createVoiceActions(ctx: ActionContext) {
  const { dispatch, stateRef, socketRef, voiceRef, identityRef } = ctx;

  const emitVoiceState = (muted: boolean, deafened: boolean) => socketRef.current?.emit('voice:state', { muted, deafened });

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

    async switchScreenShare() {
      const voice = voiceRef.current;
      const socket = socketRef.current;
      if (!voice || !socket) return;
      try {
        const { stream, audioFailed, title } = await voice.switchScreen();
        // O nome novo vai para a lista da sala; o servidor só atualiza o título, quem assiste não percebe.
        await socket.emitWithAck('stream:start', { title });
        dispatch({ type: 'screen:mine', stream });
        if (audioFailed) {
          dispatch({ type: 'voice:self', patch: { error: 'O sistema não liberou o som: a tela está indo sem áudio.' } });
        }
      } catch (err) {
        // Cancelar o seletor não é erro: a transmissão segue como estava.
        const message = describeScreenError(err);
        if (message) dispatch({ type: 'voice:self', patch: { error: message } });
      }
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

    // ── Quadro de som ──

    async loadSounds(spaceId) {
      const socket = socketRef.current;
      if (!socket) return 'Sem conexão com o servidor.';
      try {
        const res = await socket.timeout(10_000).emitWithAck('sounds:list', { spaceId });
        if (!res.ok) return res.error;
        dispatch({ type: 'sounds:set', spaceId, clips: res.data });
        return null;
      } catch {
        return 'O servidor não respondeu. Tente de novo.';
      }
    },

    async addSound(spaceId, file, name, emoji) {
      const problem = await checkSoundFile(file);
      if (problem) return problem;
      const res = await uploadSound(identityRef.current.token, spaceId, file, name, emoji);
      return res.ok ? null : res.error;
    },

    removeSound: (id) => ask(ctx, (s) => s.timeout(10_000).emitWithAck('sound:remove', { id })),

    async playSound(clip, volume, monitor) {
      const voice = voiceRef.current;
      if (!voice) return 'Entre em um canal de voz para usar o quadro de som.';
      try {
        await voice.playSound(clip.id, () => fetchSound(clip.id), volume, monitor);
        return null;
      } catch (err) {
        return err instanceof Error ? err.message : 'Não foi possível tocar o som.';
      }
    },

    stopSounds() {
      voiceRef.current?.stopSounds();
    },
  } satisfies Partial<RealtimeActions>;
}

// Salas de voz: o servidor guarda quem está em cada sala e repassa a
// sinalização WebRTC (SDP e candidatos ICE). O áudio vai direto entre os
// navegadores (malha P2P). Para salas grandes, troque por um SFU; ver README.
//
// Compartilhamento de tela: o servidor só guarda quem está ao vivo e quem
// assiste a quem (`streaming`/`watching` na lista da sala). Quem transmite
// lê essa lista e manda o vídeo apenas para quem está assistindo.

import type { Id } from '../../../shared/src/models.js';
import { Permission } from '../../../shared/src/permissions.js';
import type { SignalPayload } from '../../../shared/src/protocol.js';
import { toParticipant, type Store, type VoiceSession } from '../store.js';
import type { IceConfig } from '../turn.js';
import { channelWithPermission, isFunction } from './guards.js';
import { rooms, type AppSocket, type IO } from './types.js';

const MAX_SDP_LENGTH = 100_000;

function isSignal(value: unknown): value is SignalPayload {
  if (typeof value !== 'object' || value === null) return false;
  const signal = value as Partial<Record<string, unknown>>;
  if (signal.kind === 'description') {
    const d = signal.description as Partial<Record<string, unknown>> | undefined;
    return (
      (d?.type === 'offer' || d?.type === 'answer') && typeof d.sdp === 'string' && d.sdp.length < MAX_SDP_LENGTH
    );
  }
  return signal.kind === 'candidate' && typeof signal.candidate === 'object' && signal.candidate !== null;
}

function broadcastRoster(io: IO, store: Store, spaceId: Id, channelId: Id): void {
  const participants = store.voiceIn(channelId).map(toParticipant);
  io.to(rooms.space(spaceId)).emit('voice:update', { channelId, participants });
}

/**
 * Encerra uma sessão de voz no servidor e avisa os outros participantes.
 * Com `reason`, também avisa o dono da sessão, que ainda não sabe que saiu.
 */
export function endVoiceSession(io: IO, store: Store, session: VoiceSession, reason?: string): void {
  store.voice.delete(session.userId);
  if (session.streaming) stopWatchersOf(store, session);
  if (reason) io.to(session.socketId).emit('voice:ended', { reason });
  io.in(session.socketId).socketsLeave(rooms.voice(session.channelId));
  io.to(rooms.voice(session.channelId)).emit('voice:peer-left', { userId: session.userId });
  broadcastRoster(io, store, session.spaceId, session.channelId);
}

/** Quem assistia à transmissão deixa de assistir (ela acabou). */
function stopWatchersOf(store: Store, streamer: VoiceSession): void {
  for (const viewer of store.voiceIn(streamer.channelId)) {
    if (viewer.watching === streamer.userId) viewer.watching = null;
  }
}

export function registerVoice(io: IO, socket: AppSocket, store: Store, ice: IceConfig): void {
  const { userId } = socket.data;
  const endSession = (session: VoiceSession, reason?: string) => endVoiceSession(io, store, session, reason);

  /** Só o socket que abriu a sessão pode encerrá-la. */
  const leave = () => {
    const session = store.voice.get(userId);
    if (session?.socketId === socket.id) endSession(session);
  };

  socket.on('voice:join', (req, ack) => {
    if (!isFunction(ack)) return;
    const channel = channelWithPermission(store, userId, req?.channelId, 'voice', Permission.CONNECT);
    if (!channel) return ack({ ok: false, error: 'Você não pode entrar neste canal de voz.' });

    const previous = store.voice.get(userId);
    if (previous) {
      const otherWindow = previous.socketId !== socket.id;
      endSession(previous, otherWindow ? 'Você entrou em uma chamada em outra janela.' : undefined);
    }

    const peers = store.voiceIn(channel.id).map((s) => s.userId);
    store.voice.set(userId, {
      userId,
      channelId: channel.id,
      spaceId: channel.spaceId,
      muted: false,
      deafened: false,
      streaming: false,
      watching: null,
      socketId: socket.id,
    });
    void socket.join(rooms.voice(channel.id));
    broadcastRoster(io, store, channel.spaceId, channel.id);
    ack({ ok: true, data: { peers, iceServers: ice.iceServers(userId), iceTransportPolicy: ice.transportPolicy } });
  });

  socket.on('voice:leave', leave);
  socket.on('disconnect', leave);

  socket.on('voice:state', (req) => {
    const session = store.voice.get(userId);
    if (session?.socketId !== socket.id) return;
    session.muted = Boolean(req?.muted);
    session.deafened = Boolean(req?.deafened);
    broadcastRoster(io, store, session.spaceId, session.channelId);
  });

  /** Sessão de voz deste socket (outra janela da mesma conta não conta). */
  const mySession = () => {
    const session = store.voice.get(userId);
    return session?.socketId === socket.id ? session : null;
  };

  socket.on('stream:start', (ack) => {
    if (!isFunction(ack)) return;
    const session = mySession();
    if (!session) return ack({ ok: false, error: 'Entre em um canal de voz para compartilhar a tela.' });
    const channel = channelWithPermission(store, userId, session.channelId, 'voice', Permission.STREAM);
    if (!channel) return ack({ ok: false, error: 'Você não tem permissão para compartilhar a tela neste canal.' });
    if (!session.streaming) {
      session.streaming = true;
      broadcastRoster(io, store, session.spaceId, session.channelId);
    }
    ack({ ok: true, data: null });
  });

  socket.on('stream:stop', () => {
    const session = mySession();
    if (!session?.streaming) return;
    session.streaming = false;
    stopWatchersOf(store, session);
    broadcastRoster(io, store, session.spaceId, session.channelId);
  });

  socket.on('stream:watch', (req, ack) => {
    if (!isFunction(ack)) return;
    const session = mySession();
    const streamer = typeof req?.userId === 'string' ? store.voice.get(req.userId) : undefined;
    if (!session) return ack({ ok: false, error: 'Entre no canal de voz para assistir.' });
    if (!streamer?.streaming || streamer.channelId !== session.channelId || streamer.userId === userId) {
      return ack({ ok: false, error: 'Essa transmissão não está disponível.' });
    }
    if (session.watching !== streamer.userId) {
      session.watching = streamer.userId;
      broadcastRoster(io, store, session.spaceId, session.channelId);
    }
    ack({ ok: true, data: null });
  });

  socket.on('stream:unwatch', () => {
    const session = mySession();
    if (!session?.watching) return;
    session.watching = null;
    broadcastRoster(io, store, session.spaceId, session.channelId);
  });

  // Repasse de sinalização: apenas entre participantes da mesma sala.
  socket.on('voice:signal', (req) => {
    const me = store.voice.get(userId);
    const target = typeof req?.to === 'string' ? store.voice.get(req.to) : undefined;
    if (!me || me.socketId !== socket.id || !target || target.channelId !== me.channelId) return;
    if (!isSignal(req.signal)) return;
    io.to(target.socketId).emit('voice:signal', { from: userId, signal: req.signal });
  });
}

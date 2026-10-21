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
const MAX_STREAM_ID_LENGTH = 100;
const isStreamId = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= MAX_STREAM_ID_LENGTH;

const MAX_STREAM_TITLE_LENGTH = 100;
/** Miniaturas de 320×180 em JPEG ficam em ~10 a 30 KB; 120 KB é folga, e o ritmo é limitado. */
const MAX_PREVIEW_LENGTH = 120_000;
const MIN_PREVIEW_INTERVAL_MS = 2000;
const PREVIEW_PATTERN = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;

const isPreviewImage = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= MAX_PREVIEW_LENGTH && PREVIEW_PATTERN.test(value);

/** O nome do que é compartilhado, sem espaços sobrando; vazio ou inválido vira `null`. */
function cleanStreamTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const title = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_STREAM_TITLE_LENGTH);
  return title || null;
}

function isSignal(value: unknown): value is SignalPayload {
  if (typeof value !== 'object' || value === null) return false;
  const signal = value as Partial<Record<string, unknown>>;
  if (signal.kind === 'description') {
    const d = signal.description as Partial<Record<string, unknown>> | undefined;
    return (
      (d?.type === 'offer' || d?.type === 'answer') && typeof d.sdp === 'string' && d.sdp.length < MAX_SDP_LENGTH
    );
  }
  if (signal.kind === 'media') return isStreamId(signal.camera) && isStreamId(signal.screen);
  return signal.kind === 'candidate' && typeof signal.candidate === 'object' && signal.candidate !== null;
}

export function broadcastRoster(io: IO, store: Store, spaceId: Id, channelId: Id): void {
  const participants = store.voiceIn(channelId).map(toParticipant);
  io.to(rooms.space(spaceId)).emit('voice:update', { channelId, participants });
}

/**
 * Encerra uma sessão de voz no servidor e avisa os outros participantes.
 * Com `reason`, também avisa o dono da sessão, que ainda não sabe que saiu.
 */
export function endVoiceSession(io: IO, store: Store, session: VoiceSession, reason?: string): void {
  store.voice.delete(session.userId);
  for (const observer of store.voiceObservers) observer.sessionEnded?.(session);
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
      video: false,
      streaming: false,
      streamTitle: null,
      activity: null,
      watching: null,
      socketId: socket.id,
      streamPreview: null,
      streamPreviewAt: 0,
    });
    void socket.join(rooms.voice(channel.id));
    broadcastRoster(io, store, channel.spaceId, channel.id);
    ack({ ok: true, data: { peers, iceServers: ice.iceServers(userId), iceTransportPolicy: ice.transportPolicy } });
    const session = store.voice.get(userId);
    if (session) for (const observer of store.voiceObservers) observer.sessionStarted?.(session);
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

  socket.on('voice:video', (req, ack) => {
    if (!isFunction(ack)) return;
    const session = mySession();
    if (!session) return ack({ ok: false, error: 'Entre em um canal de voz para ligar a câmera.' });
    const enabled = Boolean(req?.enabled);
    if (enabled && !channelWithPermission(store, userId, session.channelId, 'voice', Permission.STREAM)) {
      return ack({ ok: false, error: 'Você não tem permissão para usar vídeo neste canal.' });
    }
    if (session.video !== enabled) {
      session.video = enabled;
      broadcastRoster(io, store, session.spaceId, session.channelId);
    }
    ack({ ok: true, data: null });
  });

  // Versões antigas do site mandavam só o `ack`; aceitamos as duas formas.
  socket.on('stream:start', (req, maybeAck) => {
    const legacy = typeof req === 'function';
    const ack = (legacy ? req : maybeAck) as typeof maybeAck;
    if (!isFunction(ack)) return;
    const session = mySession();
    if (!session) return ack({ ok: false, error: 'Entre em um canal de voz para compartilhar a tela.' });
    const channel = channelWithPermission(store, userId, session.channelId, 'voice', Permission.STREAM);
    if (!channel) return ack({ ok: false, error: 'Você não tem permissão para compartilhar a tela neste canal.' });
    const title = cleanStreamTitle(legacy ? null : req?.title);
    if (!session.streaming || session.streamTitle !== title) {
      session.streaming = true;
      session.streamTitle = title;
      broadcastRoster(io, store, session.spaceId, session.channelId);
    }
    ack({ ok: true, data: null });
  });

  socket.on('stream:stop', () => {
    const session = mySession();
    if (!session?.streaming) return;
    session.streaming = false;
    session.streamTitle = null;
    session.streamPreview = null;
    stopWatchersOf(store, session);
    broadcastRoster(io, store, session.spaceId, session.channelId);
  });

  socket.on('stream:preview', (req) => {
    const session = mySession();
    if (!session?.streaming || !isPreviewImage(req?.image)) return;
    const now = Date.now();
    if (now - session.streamPreviewAt < MIN_PREVIEW_INTERVAL_MS) return;
    session.streamPreview = req.image;
    session.streamPreviewAt = now;
  });

  socket.on('stream:preview:get', (req, ack) => {
    if (!isFunction(ack)) return;
    const streamer = typeof req?.userId === 'string' ? store.voice.get(req.userId) : undefined;
    // Quem pode entrar no canal vê a prévia (a lista da sala já mostra quem está ao vivo), mesmo sem estar na chamada.
    if (!streamer?.streaming || !channelWithPermission(store, userId, streamer.channelId, 'voice', Permission.CONNECT)) {
      return ack({ ok: false, error: 'Essa transmissão não está disponível.' });
    }
    ack({ ok: true, data: { image: streamer.streamPreview } });
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
    // Quem vive no servidor (o bot de música) recebe a sinalização direto, sem passar por um socket.
    for (const observer of store.voiceObservers) {
      if (observer.signal?.(userId, target.userId, req.signal)) return;
    }
    io.to(target.socketId).emit('voice:signal', { from: userId, signal: req.signal });
  });
}

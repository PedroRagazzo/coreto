// Salas de voz: o servidor guarda quem está em cada sala e repassa a
// sinalização WebRTC (SDP e candidatos ICE). O áudio vai direto entre os
// navegadores (malha P2P). Para salas grandes, troque por um SFU; ver README.

import type { Id } from '../../../shared/src/models.js';
import { Permission } from '../../../shared/src/permissions.js';
import type { IceServer, SignalPayload } from '../../../shared/src/protocol.js';
import { toParticipant, type Store, type VoiceSession } from '../store.js';
import { channelWithPermission, isFunction } from './guards.js';
import { rooms, type AppSocket, type IO } from './types.js';

const MAX_SDP_LENGTH = 100_000;

const ICE_SERVERS: IceServer[] = process.env.ICE_SERVERS
  ? (JSON.parse(process.env.ICE_SERVERS) as IceServer[])
  : [{ urls: 'stun:stun.l.google.com:19302' }];

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

export function registerVoice(io: IO, socket: AppSocket, store: Store): void {
  const { userId } = socket.data;

  const broadcastRoster = (spaceId: Id, channelId: Id) => {
    const participants = store.voiceIn(channelId).map(toParticipant);
    io.to(rooms.space(spaceId)).emit('voice:update', { channelId, participants });
  };

  const endSession = (session: VoiceSession) => {
    store.voice.delete(session.userId);
    io.in(session.socketId).socketsLeave(rooms.voice(session.channelId));
    io.to(rooms.voice(session.channelId)).emit('voice:peer-left', { userId: session.userId });
    broadcastRoster(session.spaceId, session.channelId);
  };

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
      if (previous.socketId !== socket.id) {
        io.to(previous.socketId).emit('voice:ended', { reason: 'Você entrou em uma chamada em outra janela.' });
      }
      endSession(previous);
    }

    const peers = store.voiceIn(channel.id).map((s) => s.userId);
    store.voice.set(userId, {
      userId,
      channelId: channel.id,
      spaceId: channel.spaceId,
      muted: false,
      deafened: false,
      socketId: socket.id,
    });
    void socket.join(rooms.voice(channel.id));
    broadcastRoster(channel.spaceId, channel.id);
    ack({ ok: true, data: { peers, iceServers: ICE_SERVERS } });
  });

  socket.on('voice:leave', leave);
  socket.on('disconnect', leave);

  socket.on('voice:state', (req) => {
    const session = store.voice.get(userId);
    if (session?.socketId !== socket.id) return;
    session.muted = Boolean(req?.muted);
    session.deafened = Boolean(req?.deafened);
    broadcastRoster(session.spaceId, session.channelId);
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

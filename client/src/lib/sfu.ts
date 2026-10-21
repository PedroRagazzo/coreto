// Transmissão de tela pelo servidor de mídia (LiveKit): quem transmite envia uma cópia só do vídeo e
// o servidor a reparte, em vez de uma cópia por espectador como na malha P2P (voice.ts).
//
// Só a tela passa por aqui. A voz e a câmera continuam P2P. A sala do LiveKit é a sala de voz, e a
// identidade de cada pessoa nela é o id do usuário. Quem entra não recebe nada sozinho: só assina
// (recebe) a tela de quem está assistindo.

import type { Id } from '@shared/models';
import type { SfuAccess } from '@shared/protocol';
import { AudioPresets, Room, RoomEvent, Track, type RemoteParticipant, type RemoteTrackPublication } from 'livekit-client';

export interface SfuEvents {
  /** Servidores ICE do Coreto (STUN/TURN): quem está atrás de um NAT restrito chega ao servidor de mídia pelo TURN. */
  rtcConfig?: RTCConfiguration;
  /** A tela de alguém começou a chegar (ou acabou, com `null`). */
  onScreen: (userId: Id, stream: MediaStream | null) => void;
  /** A conexão com o servidor de mídia acabou de vez (a reconexão automática desistiu). */
  onClosed: () => void;
  /** A conexão caiu e o LiveKit está tentando voltar; `onReconnected` avisa se conseguiu. */
  onReconnecting: () => void;
  onReconnected: () => void;
}

export interface ScreenPublishOptions {
  maxBitrate: number;
  maxFramerate: number;
  /** Nitidez mantém a resolução e deixa cair os quadros; Fluidez, o contrário. */
  priority: 'sharp' | 'smooth';
  codec: 'h264' | 'vp8';
}

const isScreenSource = (source: Track.Source) => source === Track.Source.ScreenShare || source === Track.Source.ScreenShareAudio;

export class SfuSession {
  private watching: ReadonlySet<Id> = new Set();
  private closed = false;
  /** Só depois de conectar os avisos de queda e reconexão valem; falhar ao conectar é erro de `connect`. */
  private connected = false;
  /** Um fluxo por transmissão, que ganha e perde faixas conforme elas chegam. */
  private readonly streams = new Map<Id, MediaStream>();
  private readonly announced = new Set<Id>();
  private published: { video: MediaStreamTrack; audio: MediaStreamTrack | null } | null = null;

  private constructor(
    private readonly room: Room,
    private readonly events: SfuEvents,
  ) {
    const resync = () => this.syncSubscriptions();
    room
      .on(RoomEvent.TrackPublished, resync)
      .on(RoomEvent.ParticipantConnected, resync)
      .on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
        if (!isScreenSource(track.source)) return;
        this.addTrack(participant.identity, track.mediaStreamTrack);
      })
      .on(RoomEvent.TrackUnsubscribed, (track, _publication, participant) => {
        if (!isScreenSource(track.source)) return;
        this.removeTrack(participant.identity, track.mediaStreamTrack);
      })
      .on(RoomEvent.ParticipantDisconnected, (participant) => this.dropStream(participant.identity))
      // O sinal cai antes de a mídia dar sinal de vida: se o servidor morreu, é o primeiro aviso que chega.
      .on(RoomEvent.SignalReconnecting, () => this.connected && events.onReconnecting())
      .on(RoomEvent.Reconnecting, () => this.connected && events.onReconnecting())
      .on(RoomEvent.Reconnected, () => this.connected && events.onReconnected())
      .on(RoomEvent.Disconnected, () => {
        if (this.closed || !this.connected) return;
        this.closed = true;
        this.dropAll();
        events.onClosed();
      });
  }

  /** Entra na sala; falha (para a chamada cair de volta no P2P) se o servidor de mídia não responder. */
  static async connect(access: SfuAccess, events: SfuEvents): Promise<SfuSession> {
    const room = new Room({ adaptiveStream: false, dynacast: false });
    const session = new SfuSession(room, events);
    try {
      await room.connect(access.url, access.token, {
        rtcConfig: events.rtcConfig,
        autoSubscribe: false,
        websocketTimeout: 8_000,
        peerConnectionTimeout: 10_000,
        maxRetries: 1,
      });
    } catch (err) {
      session.closed = true;
      void room.disconnect();
      throw err;
    }
    session.connected = true;
    return session;
  }

  // ── Quem transmite ───────────────────────────────────────────────────────────

  /** Envia a tela (e o som dela, se houver) para o servidor, uma cópia só, qualquer que seja o número de espectadores. */
  async publishScreen(video: MediaStreamTrack, audio: MediaStreamTrack | null, options: ScreenPublishOptions): Promise<void> {
    await this.unpublishScreen();
    const encoding = { maxBitrate: options.maxBitrate, maxFramerate: options.maxFramerate };
    const { localParticipant } = this.room;
    await localParticipant.publishTrack(video, {
      source: Track.Source.ScreenShare,
      simulcast: false,
      videoCodec: options.codec,
      // Sem o codec de reserva: ele codificaria o vídeo duas vezes, o que é justamente o que se quer evitar.
      backupCodec: false,
      // Para telas, o LiveKit lê `screenShareEncoding` e ignora `videoEncoding`.
      screenShareEncoding: encoding,
      videoEncoding: encoding,
      degradationPreference: options.priority === 'sharp' ? 'maintain-resolution' : 'maintain-framerate',
    });
    this.published = { video, audio: null };
    if (audio) {
      await localParticipant.publishTrack(audio, {
        source: Track.Source.ScreenShareAudio,
        audioPreset: AudioPresets.musicStereo,
        forceStereo: true,
        dtx: false,
        red: false,
      });
      this.published.audio = audio;
    }
  }

  /** Tira a tela do ar sem parar as faixas (quem chama é dono delas). */
  async unpublishScreen(): Promise<void> {
    const published = this.published;
    if (!published) return;
    this.published = null;
    const { localParticipant } = this.room;
    await localParticipant.unpublishTrack(published.video, false).catch(() => undefined);
    if (published.audio) await localParticipant.unpublishTrack(published.audio, false).catch(() => undefined);
  }

  /** O emissor do vídeo da tela, para ajustar o bitrate e ler estatísticas. */
  get videoSender(): RTCRtpSender | null {
    const publication = this.room.localParticipant.getTrackPublication(Track.Source.ScreenShare);
    return publication?.track?.sender ?? null;
  }

  // ── Quem assiste ─────────────────────────────────────────────────────────────

  /** Passa a receber só as telas de `userIds` (todas de uma vez); lista vazia para de receber. */
  watch(userIds: Iterable<Id>): void {
    this.watching = new Set(userIds);
    this.syncSubscriptions();
  }

  /** O receptor do vídeo da tela de `userId`, para ler estatísticas. */
  receiverFor(userId: Id): RTCRtpReceiver | null {
    const publication = this.room.remoteParticipants.get(userId)?.getTrackPublication(Track.Source.ScreenShare);
    return publication?.track?.receiver ?? null;
  }

  close(): void {
    this.closed = true;
    this.dropAll();
    // `false`: as faixas da captura são de quem chamou, que as para por conta própria.
    void this.room.disconnect(false);
  }

  private syncSubscriptions(): void {
    if (this.closed) return;
    this.room.remoteParticipants.forEach((participant: RemoteParticipant) => {
      participant.trackPublications.forEach((publication: RemoteTrackPublication) => {
        if (!isScreenSource(publication.source)) return;
        const wanted = this.watching.has(participant.identity);
        if (publication.isSubscribed !== wanted) publication.setSubscribed(wanted);
      });
    });
  }

  private addTrack(userId: Id, track: MediaStreamTrack): void {
    let stream = this.streams.get(userId);
    if (!stream) this.streams.set(userId, (stream = new MediaStream()));
    stream.addTrack(track);
    // Só anuncia com imagem: o som sozinho não abre o palco.
    if (!this.announced.has(userId) && stream.getVideoTracks().length > 0) {
      this.announced.add(userId);
      this.events.onScreen(userId, stream);
    }
  }

  private removeTrack(userId: Id, track: MediaStreamTrack): void {
    const stream = this.streams.get(userId);
    if (!stream) return;
    stream.removeTrack(track);
    if (stream.getVideoTracks().length === 0) this.dropStream(userId);
  }

  private dropStream(userId: Id): void {
    this.streams.delete(userId);
    if (this.announced.delete(userId)) this.events.onScreen(userId, null);
  }

  private dropAll(): void {
    for (const userId of [...this.streams.keys()]) this.dropStream(userId);
  }
}

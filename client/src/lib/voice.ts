// Cliente de voz em malha P2P: uma RTCPeerConnection por participante.
// Quem entra na sala envia a oferta para cada participante que já estava lá;
// depois disso qualquer lado pode renegociar (para mandar a tela, por exemplo),
// com o padrão "perfect negotiation" resolvendo ofertas simultâneas.
// Quem está falando é medido aqui mesmo, no áudio que chega (e no microfone):
// nada disso passa pelo servidor.

import type { Id } from '@shared/models';
import type { IceServer, SignalPayload } from '@shared/protocol';
import type { AppSocket } from './socket';

/** Volume (RMS, 0–1) acima do qual conta como fala. */
const SPEAKING_THRESHOLD = 0.02;
/** Depois do último som alto, continua "falando" por este tempo, para o anel não piscar entre palavras. */
const SPEAKING_HOLD_MS = 300;
const SPEAKING_POLL_MS = 100;

interface Meter {
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  samples: Float32Array<ArrayBuffer>;
  lastLoudAt: number;
}

/** Mede o volume de vários fluxos de áudio e avisa quando o conjunto de quem fala muda. */
class SpeakingDetector {
  private context: AudioContext | null = null;
  private readonly meters = new Map<Id, Meter>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private speaking = new Set<Id>();

  constructor(private readonly onChange: (speaking: Set<Id>) => void) {}

  watch(id: Id, stream: MediaStream): void {
    this.unwatch(id);
    this.context ??= new AudioContext();
    void this.context.resume();
    const source = this.context.createMediaStreamSource(stream);
    const analyser = this.context.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser); // só mede: não liga na saída, o som toca pelo <audio>
    this.meters.set(id, { source, analyser, samples: new Float32Array(analyser.fftSize), lastLoudAt: 0 });
    this.timer ??= setInterval(() => this.poll(), SPEAKING_POLL_MS);
  }

  unwatch(id: Id): void {
    const meter = this.meters.get(id);
    if (!meter) return;
    meter.source.disconnect();
    this.meters.delete(id);
    this.poll();
  }

  stop(): void {
    for (const id of [...this.meters.keys()]) this.unwatch(id);
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    void this.context?.close();
    this.context = null;
  }

  private poll(): void {
    const now = performance.now();
    const speaking = new Set<Id>();
    for (const [id, meter] of this.meters) {
      meter.analyser.getFloatTimeDomainData(meter.samples);
      let sum = 0;
      for (const sample of meter.samples) sum += sample * sample;
      if (Math.sqrt(sum / meter.samples.length) > SPEAKING_THRESHOLD) meter.lastLoudAt = now;
      if (now - meter.lastLoudAt < SPEAKING_HOLD_MS) speaking.add(id);
    }
    const changed = speaking.size !== this.speaking.size || [...speaking].some((id) => !this.speaking.has(id));
    this.speaking = speaking;
    if (changed) this.onChange(speaking);
  }
}

/** Qualidade da transmissão de tela, como no seletor do Discord. */
export interface ScreenShareOptions {
  /** Altura máxima em pixels; `null` = resolução original da tela. */
  height: 720 | 1080 | null;
  frameRate: 15 | 30 | 60;
  /** Pede também o som (o Chrome oferece para abas e para a tela inteira no Windows). */
  audio: boolean;
}

/** Teto de bits por segundo do vídeo, por altura × quadros. */
function maxBitrate({ height, frameRate }: ScreenShareOptions): number {
  const base = height === 720 ? 2_500_000 : height === 1080 ? 4_500_000 : 6_000_000;
  return frameRate === 60 ? base * 1.5 : frameRate === 15 ? base * 0.6 : base;
}

export interface VoiceEvents {
  /** Quem está falando agora (incluindo você), a cada mudança. */
  onSpeaking?: (speaking: Set<Id>) => void;
  /** A tela de alguém começou a chegar (ou parou de existir, com `null`). */
  onRemoteScreen?: (userId: Id, stream: MediaStream | null) => void;
  /** Você parou de compartilhar pelo próprio navegador (botão "Parar de compartilhar"). */
  onScreenEnded?: () => void;
}

interface Peer {
  pc: RTCPeerConnection;
  /** "Perfect negotiation": em colisão de ofertas, o lado educado cede. */
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  audio: HTMLAudioElement | null;
  /** Id do fluxo do microfone remoto; qualquer outro fluxo é a tela. */
  micStreamId: string | null;
  /** Transceptores da sua tela para esta pessoa, criados na primeira vez que ela assiste. */
  screenVideo: RTCRtpTransceiver | null;
  screenAudio: RTCRtpTransceiver | null;
}

export class VoiceManager {
  private localStream: MediaStream | null = null;
  private iceServers: IceServer[] = [];
  private iceTransportPolicy: RTCIceTransportPolicy = 'all';
  private readonly peers = new Map<Id, Peer>();
  private deafened = false;
  private selfId: Id | null = null;
  private readonly detector: SpeakingDetector;
  private screen: { stream: MediaStream; options: ScreenShareOptions } | null = null;
  /** Quem deve receber sua tela agora (quem está assistindo, segundo o servidor). */
  private screenViewers = new Set<Id>();
  /** Sinais são processados um por vez, na ordem de chegada (o candidato não pode passar à frente da oferta). */
  private signals: Promise<void> = Promise.resolve();

  constructor(
    private readonly socket: AppSocket,
    private readonly events: VoiceEvents = {},
  ) {
    this.detector = new SpeakingDetector(events.onSpeaking ?? (() => {}));
    socket.on('voice:signal', ({ from, signal }) => {
      this.signals = this.signals.then(() => this.handleSignal(from, signal));
    });
    socket.on('voice:peer-left', ({ userId }) => this.closePeer(userId));
  }

  async join(channelId: Id, startMuted: boolean, selfId: Id): Promise<void> {
    this.teardown();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    const res = await this.socket.emitWithAck('voice:join', { channelId });
    if (!res.ok) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error(res.error);
    }
    this.localStream = stream;
    this.iceServers = res.data.iceServers;
    this.iceTransportPolicy = res.data.iceTransportPolicy;
    this.selfId = selfId;
    this.setMuted(startMuted);
    // Microfone desativado manda silêncio, então você deixa de "falar" sozinho.
    this.detector.watch(selfId, stream);
    // Quem chega liga para quem já estava: adicionar o microfone dispara a primeira oferta.
    for (const peerId of res.data.peers) this.addLocalAudio(this.createPeer(peerId));
  }

  leave(): void {
    if (!this.localStream) return;
    this.socket.emit('voice:leave');
    this.teardown();
  }

  /** Encerra tudo localmente sem avisar o servidor (ele já encerrou ou caiu). */
  teardown(): void {
    this.stopScreen();
    for (const peerId of [...this.peers.keys()]) this.closePeer(peerId);
    if (this.selfId) this.detector.unwatch(this.selfId);
    this.detector.stop();
    this.localStream?.getTracks().forEach((track) => track.stop());
    this.localStream = null;
    this.selfId = null;
  }

  setMuted(muted: boolean): void {
    this.localStream?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
  }

  setDeafened(deafened: boolean): void {
    this.deafened = deafened;
    for (const peer of this.peers.values()) if (peer.audio) peer.audio.muted = deafened;
  }

  // ── Compartilhamento de tela ───────────────────────────────────────────────

  /**
   * Abre o seletor de tela do navegador. Chame direto do clique (o navegador
   * exige um gesto). Ninguém recebe nada até `setScreenViewers` dizer quem assiste.
   */
  async startScreen(options: ScreenShareOptions): Promise<MediaStream> {
    if (!this.localStream) throw new Error('Entre em um canal de voz para compartilhar a tela.');
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        frameRate: { ideal: options.frameRate, max: options.frameRate },
        ...(options.height && { height: { ideal: options.height, max: options.height } }),
      },
      audio: options.audio,
    });
    this.stopScreen();
    const [video] = stream.getVideoTracks();
    // Texto e código pedem nitidez; jogos e vídeos, fluidez.
    video.contentHint = options.frameRate >= 30 ? 'motion' : 'detail';
    // O usuário pode parar pelo aviso do próprio navegador.
    video.addEventListener('ended', () => {
      if (this.screen?.stream === stream) this.events.onScreenEnded?.();
    });
    this.screen = { stream, options };
    this.applyScreenViewers();
    return stream;
  }

  stopScreen(): void {
    if (!this.screen) return;
    this.screen.stream.getTracks().forEach((track) => track.stop());
    this.screen = null;
    this.applyScreenViewers();
  }

  /** Atualiza quem recebe sua tela; chame sempre que a lista da sala mudar. */
  setScreenViewers(viewers: Iterable<Id>): void {
    this.screenViewers = new Set(viewers);
    this.applyScreenViewers();
  }

  /**
   * Manda a tela para quem assiste e nada para os outros. O transceptor de cada
   * pessoa é criado uma vez (uma renegociação) e depois só troca de faixa, sem
   * renegociar: parar e voltar a assistir é instantâneo.
   */
  private applyScreenViewers(): void {
    const video = this.screen?.stream.getVideoTracks()[0] ?? null;
    const audio = this.screen?.stream.getAudioTracks()[0] ?? null;
    for (const [peerId, peer] of this.peers) {
      const watching = this.screen !== null && this.screenViewers.has(peerId);
      this.sendScreenTrack(peer, 'screenVideo', watching ? video : null);
      this.sendScreenTrack(peer, 'screenAudio', watching ? audio : null);
    }
  }

  private sendScreenTrack(peer: Peer, slot: 'screenVideo' | 'screenAudio', track: MediaStreamTrack | null): void {
    const transceiver = peer[slot];
    if (!transceiver) {
      if (!track || !this.screen) return;
      const encodings: RTCRtpEncodingParameters[] =
        track.kind === 'video'
          ? [{ maxBitrate: maxBitrate(this.screen.options), maxFramerate: this.screen.options.frameRate }]
          : [];
      peer[slot] = peer.pc.addTransceiver(track, {
        direction: 'sendonly',
        streams: [this.screen.stream],
        sendEncodings: encodings,
      });
      return;
    }
    void transceiver.sender.replaceTrack(track).catch((err: unknown) => console.warn('[tela] replaceTrack', err));
    if (track?.kind === 'video' && this.screen) void this.updateEncoding(transceiver.sender, this.screen.options);
  }

  private async updateEncoding(sender: RTCRtpSender, options: ScreenShareOptions): Promise<void> {
    const params = sender.getParameters();
    if (!params.encodings?.length) return;
    params.encodings[0].maxBitrate = maxBitrate(options);
    params.encodings[0].maxFramerate = options.frameRate;
    await sender.setParameters(params).catch((err: unknown) => console.warn('[tela] setParameters', err));
  }

  // ── Conexões ───────────────────────────────────────────────────────────────

  private createPeer(peerId: Id): Peer {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers, iceTransportPolicy: this.iceTransportPolicy });
    const peer: Peer = {
      pc,
      // Regra fixa e igual dos dois lados: o menor id cede numa colisão.
      polite: (this.selfId ?? '') < peerId,
      makingOffer: false,
      ignoreOffer: false,
      audio: null,
      micStreamId: null,
      screenVideo: null,
      screenAudio: null,
    };
    this.peers.set(peerId, peer);

    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        this.sendDescription(peerId, pc);
      } catch (err) {
        console.warn('[voz] falha ao negociar com', peerId, err);
      } finally {
        peer.makingOffer = false;
      }
    };
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.signal(peerId, { kind: 'candidate', candidate: candidate.toJSON() });
    };
    pc.ontrack = ({ track, streams: [remote] }) => {
      if (!remote) return;
      const isMic = track.kind === 'audio' && (peer.micStreamId ?? remote.id) === remote.id;
      if (isMic) {
        peer.micStreamId = remote.id;
        const audio = peer.audio ?? new Audio();
        audio.autoplay = true;
        audio.srcObject = remote;
        audio.muted = this.deafened;
        peer.audio = audio;
        this.detector.watch(peerId, remote);
        audio.play().catch(() => {
          // O navegador pode bloquear autoplay; o clique em "entrar" normalmente libera.
        });
      } else if (track.kind === 'video') {
        this.events.onRemoteScreen?.(peerId, remote);
      }
      // O som da tela vem no mesmo fluxo do vídeo e toca pelo <video> de quem assiste.
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') pc.restartIce();
    };
    return peer;
  }

  private addLocalAudio(peer: Peer): void {
    const stream = this.localStream;
    stream?.getAudioTracks().forEach((track) => peer.pc.addTrack(track, stream));
  }

  private async handleSignal(from: Id, signal: SignalPayload): Promise<void> {
    if (!this.localStream) return;
    const known = this.peers.get(from);
    const peer = known ?? this.createPeer(from);
    const { pc } = peer;
    try {
      if (signal.kind === 'description') {
        const { description } = signal;
        const collision = description.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
        peer.ignoreOffer = !peer.polite && collision;
        if (peer.ignoreOffer) return;
        await pc.setRemoteDescription(description); // em colisão, desfaz a oferta local sozinho
        if (description.type === 'offer') {
          // Quem recebe a primeira oferta só adiciona o microfone agora, reaproveitando o
          // transceptor que a oferta criou (antes disso, criaria outro e renegociaria à toa).
          if (!known) this.addLocalAudio(peer);
          await pc.setLocalDescription();
          this.sendDescription(from, pc);
        }
        if (!known) this.applyScreenViewers();
      } else {
        try {
          await pc.addIceCandidate(signal.candidate);
        } catch (err) {
          if (!peer.ignoreOffer) throw err;
        }
      }
    } catch (err) {
      console.warn('[voz] falha ao processar sinalização de', from, err);
    }
  }

  private sendDescription(peerId: Id, pc: RTCPeerConnection): void {
    const description = pc.localDescription;
    if (description?.type !== 'offer' && description?.type !== 'answer') return;
    this.signal(peerId, { kind: 'description', description: { type: description.type, sdp: description.sdp } });
  }

  private signal(to: Id, signal: SignalPayload): void {
    this.socket.emit('voice:signal', { to, signal });
  }

  private closePeer(peerId: Id): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    peer.pc.close();
    if (peer.audio) peer.audio.srcObject = null;
    this.detector.unwatch(peerId);
    this.peers.delete(peerId);
    this.events.onRemoteScreen?.(peerId, null);
  }
}

export function describeMediaError(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === 'NotAllowedError') return 'Permissão do microfone negada pelo navegador.';
    if (err.name === 'NotFoundError') return 'Nenhum microfone encontrado.';
    if (err.name === 'NotReadableError') return 'O microfone está em uso por outro programa.';
  }
  return err instanceof Error ? err.message : 'Não foi possível entrar na chamada.';
}

/** Mensagem para falhas do seletor de tela; `null` quando a pessoa só cancelou. */
export function describeScreenError(err: unknown): string | null {
  if (err instanceof DOMException) {
    if (err.name === 'NotAllowedError' || err.name === 'AbortError') return null;
    if (err.name === 'NotReadableError') return 'O navegador não conseguiu capturar essa tela.';
    if (err.name === 'NotSupportedError') return 'Este navegador não compartilha a tela.';
  }
  return err instanceof Error ? err.message : 'Não foi possível compartilhar a tela.';
}

// Cliente de voz em malha P2P: uma RTCPeerConnection por participante.
// Quem entra na sala envia a oferta para cada participante que já estava lá;
// depois disso qualquer lado pode renegociar (para mandar a tela, por exemplo),
// com o padrão "perfect negotiation" resolvendo ofertas simultâneas.
// Quem está falando é medido aqui mesmo, no áudio que chega (e no microfone):
// nada disso passa pelo servidor.
//
// Câmera e tela vão em fluxos "portadores" fixos durante a chamada; ao abrir
// cada conexão, os dois lados anunciam os ids deles (sinal `media`), e é assim
// que quem recebe sabe qual vídeo é a câmera e qual é a tela.

import type { Id } from '@shared/models';
import type { IceServer, SignalPayload } from '@shared/protocol';
import { DEFAULT_SETTINGS, microphoneConstraints, type VoicePrefs } from './settings';
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

/**
 * Microfone → ganho → saída fixa. Trocar de microfone só troca a fonte: a faixa
 * enviada às conexões continua a mesma, sem renegociar no meio da chamada.
 */
class MicPipeline {
  private readonly context = new AudioContext();
  private readonly gain = this.context.createGain();
  private readonly output = this.context.createMediaStreamDestination();
  private source: MediaStreamAudioSourceNode | null = null;
  private raw: MediaStream | null = null;
  /** O que vai para as conexões e para o medidor de fala. */
  readonly stream = this.output.stream;

  constructor(volume: number) {
    this.gain.gain.value = volume;
    this.gain.connect(this.output);
    void this.context.resume();
  }

  use(raw: MediaStream): void {
    this.source?.disconnect();
    this.raw?.getTracks().forEach((track) => track.stop());
    this.raw = raw;
    this.source = this.context.createMediaStreamSource(raw);
    this.source.connect(this.gain);
  }

  setVolume(volume: number): void {
    this.gain.gain.setTargetAtTime(volume, this.context.currentTime, 0.05);
  }

  close(): void {
    this.source?.disconnect();
    this.raw?.getTracks().forEach((track) => track.stop());
    this.stream.getTracks().forEach((track) => track.stop());
    void this.context.close();
  }
}

/** Abre o microfone escolhido; se ele não existir mais (desconectado), usa o padrão do sistema. */
export async function openMicrophone(prefs: VoicePrefs): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: microphoneConstraints(prefs), video: false });
  } catch (err) {
    const missing = err instanceof DOMException && (err.name === 'OverconstrainedError' || err.name === 'NotFoundError');
    if (!prefs.inputDeviceId || !missing) throw err;
    return navigator.mediaDevices.getUserMedia({ audio: microphoneConstraints({ ...prefs, inputDeviceId: null }), video: false });
  }
}

async function openCamera(deviceId: string | null): Promise<MediaStream> {
  const constraints = (id: string | null) => ({ ...CAMERA_CONSTRAINTS, ...(id && { deviceId: { exact: id } }) });
  try {
    return await navigator.mediaDevices.getUserMedia({ video: constraints(deviceId), audio: false });
  } catch (err) {
    const missing = err instanceof DOMException && (err.name === 'OverconstrainedError' || err.name === 'NotFoundError');
    if (!deviceId || !missing) throw err;
    return navigator.mediaDevices.getUserMedia({ video: constraints(null), audio: false });
  }
}

/** Saída de áudio escolhida (onde o navegador permite) e volume. */
export function applyOutput(element: HTMLMediaElement, prefs: VoicePrefs, volume = prefs.outputVolume): void {
  element.volume = volume;
  if ('setSinkId' in element) {
    void element.setSinkId(prefs.outputDeviceId ?? '').catch((err: unknown) => console.warn('[voz] setSinkId', err));
  }
}

const micChanged = (a: VoicePrefs, b: VoicePrefs) =>
  a.inputDeviceId !== b.inputDeviceId ||
  a.echoCancellation !== b.echoCancellation ||
  a.noiseSuppression !== b.noiseSuppression ||
  a.autoGainControl !== b.autoGainControl;

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

/** Câmera leve para caber na malha: cada pessoa envia uma cópia para cada outra. */
const CAMERA_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 640 },
  height: { ideal: 360 },
  frameRate: { ideal: 24, max: 30 },
};
const CAMERA_MAX_BITRATE = 600_000;

export interface VoiceEvents {
  /** Quem está falando agora (incluindo você), a cada mudança. */
  onSpeaking?: (speaking: Set<Id>) => void;
  /** A tela de alguém começou a chegar (ou parou de existir, com `null`). */
  onRemoteScreen?: (userId: Id, stream: MediaStream | null) => void;
  /** A câmera de alguém começou a chegar (ou parou de existir, com `null`). */
  onRemoteCamera?: (userId: Id, stream: MediaStream | null) => void;
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
  /** Seu microfone (e câmera/tela, se houver) já está nesta conexão. */
  sending: boolean;
  /** Ids dos fluxos de câmera e tela do outro lado (sinal `media`). */
  remoteMedia: { camera: string; screen: string } | null;
  /** Fluxos de vídeo recebidos, por id, até saber se são câmera ou tela. */
  remoteVideo: Map<string, MediaStream>;
  /** Transceptores do que você envia: tela (para quem assiste) e câmera (para todos). */
  screenVideo: RTCRtpTransceiver | null;
  screenAudio: RTCRtpTransceiver | null;
  cameraVideo: RTCRtpTransceiver | null;
}

type Slot = 'screenVideo' | 'screenAudio' | 'cameraVideo';

export class VoiceManager {
  private localStream: MediaStream | null = null;
  private mic: MicPipeline | null = null;
  private prefs: VoicePrefs = DEFAULT_SETTINGS.voice;
  private iceServers: IceServer[] = [];
  private iceTransportPolicy: RTCIceTransportPolicy = 'all';
  private readonly peers = new Map<Id, Peer>();
  private deafened = false;
  private selfId: Id | null = null;
  private readonly detector: SpeakingDetector;
  private screen: { stream: MediaStream; options: ScreenShareOptions } | null = null;
  private camera: MediaStream | null = null;
  /** Fluxos fixos onde câmera e tela viajam; os ids são anunciados a cada pessoa. */
  private cameraCarrier = new MediaStream();
  private screenCarrier = new MediaStream();
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
    const raw = await openMicrophone(this.prefs);
    const res = await this.socket.emitWithAck('voice:join', { channelId });
    if (!res.ok) {
      raw.getTracks().forEach((track) => track.stop());
      throw new Error(res.error);
    }
    this.mic = new MicPipeline(this.prefs.inputVolume);
    this.mic.use(raw);
    const stream = this.mic.stream;
    this.localStream = stream;
    this.cameraCarrier = new MediaStream();
    this.screenCarrier = new MediaStream();
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
    this.stopCamera();
    for (const peerId of [...this.peers.keys()]) this.closePeer(peerId);
    if (this.selfId) this.detector.unwatch(this.selfId);
    this.detector.stop();
    this.mic?.close();
    this.mic = null;
    this.localStream = null;
    this.selfId = null;
  }

  /**
   * Aplica as configurações de voz e vídeo. No meio da chamada: troca o
   * microfone e o ganho, a saída e o volume das vozes, e a câmera ligada.
   * Devolve a câmera nova, se ela foi trocada.
   */
  async applyPrefs(next: VoicePrefs): Promise<{ camera: MediaStream | null }> {
    const prev = this.prefs;
    this.prefs = next;
    if (this.mic) {
      if (next.inputVolume !== prev.inputVolume) this.mic.setVolume(next.inputVolume);
      if (micChanged(prev, next)) this.mic.use(await openMicrophone(next));
    }
    if (next.outputDeviceId !== prev.outputDeviceId || next.outputVolume !== prev.outputVolume) {
      for (const peer of this.peers.values()) if (peer.audio) applyOutput(peer.audio, next);
    }
    if (this.camera && next.cameraDeviceId !== prev.cameraDeviceId) {
      const old = this.camera;
      this.camera = await openCamera(next.cameraDeviceId);
      this.applyCamera();
      old.getTracks().forEach((track) => track.stop());
      return { camera: this.camera };
    }
    return { camera: null };
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
  async startScreen(options: ScreenShareOptions): Promise<{ stream: MediaStream; audioFailed: boolean }> {
    if (!this.localStream) throw new Error('Entre em um canal de voz para compartilhar a tela.');
    const constraints: MediaTrackConstraints = {
      frameRate: { ideal: options.frameRate, max: options.frameRate },
      ...(options.height && { height: { ideal: options.height, max: options.height } }),
    };
    let stream: MediaStream;
    let audioFailed = false;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: constraints, audio: options.audio });
    } catch (err) {
      // Alguns sistemas não liberam o som (no app de desktop, "Could not start audio source"):
      // em vez de falhar, transmite só a imagem.
      if (!options.audio || !(err instanceof DOMException) || err.name !== 'NotReadableError') throw err;
      stream = await navigator.mediaDevices.getDisplayMedia({ video: constraints, audio: false });
      audioFailed = true;
    }
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
    return { stream, audioFailed };
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
    const options = this.screen?.options;
    const encodings = options ? [{ maxBitrate: maxBitrate(options), maxFramerate: options.frameRate }] : [];
    for (const [peerId, peer] of this.peers) {
      const watching = this.screen !== null && this.screenViewers.has(peerId);
      this.sendTrack(peer, 'screenVideo', watching ? video : null, this.screenCarrier, encodings);
      this.sendTrack(peer, 'screenAudio', watching ? audio : null, this.screenCarrier, []);
    }
  }

  /**
   * Põe a faixa no transceptor da vaga (criando-o na primeira vez, o que
   * renegocia) ou tira com `null`, sem renegociar.
   */
  private sendTrack(
    peer: Peer,
    slot: Slot,
    track: MediaStreamTrack | null,
    carrier: MediaStream,
    encodings: RTCRtpEncodingParameters[],
  ): void {
    const transceiver = peer[slot];
    if (!transceiver) {
      if (!track) return;
      peer[slot] = peer.pc.addTransceiver(track, { direction: 'sendonly', streams: [carrier], sendEncodings: encodings });
      return;
    }
    void transceiver.sender.replaceTrack(track).catch((err: unknown) => console.warn('[voz] replaceTrack', err));
    if (track && encodings.length) void this.updateEncoding(transceiver.sender, encodings[0]);
  }

  private async updateEncoding(sender: RTCRtpSender, encoding: RTCRtpEncodingParameters): Promise<void> {
    const params = sender.getParameters();
    if (!params.encodings?.length) return;
    params.encodings[0].maxBitrate = encoding.maxBitrate;
    params.encodings[0].maxFramerate = encoding.maxFramerate;
    await sender.setParameters(params).catch((err: unknown) => console.warn('[voz] setParameters', err));
  }

  // ── Câmera ─────────────────────────────────────────────────────────────────

  /** Liga a câmera e manda o vídeo para todos da chamada. */
  async startCamera(): Promise<MediaStream> {
    if (!this.localStream) throw new Error('Entre em um canal de voz para ligar a câmera.');
    const stream = await openCamera(this.prefs.cameraDeviceId);
    this.stopCamera();
    this.camera = stream;
    this.applyCamera();
    return stream;
  }

  stopCamera(): void {
    if (!this.camera) return;
    this.camera.getTracks().forEach((track) => track.stop());
    this.camera = null;
    this.applyCamera();
  }

  private applyCamera(): void {
    const track = this.camera?.getVideoTracks()[0] ?? null;
    for (const peer of this.peers.values()) {
      this.sendTrack(peer, 'cameraVideo', track, this.cameraCarrier, [{ maxBitrate: CAMERA_MAX_BITRATE }]);
    }
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
      sending: false,
      remoteMedia: null,
      remoteVideo: new Map(),
      screenVideo: null,
      screenAudio: null,
      cameraVideo: null,
    };
    this.peers.set(peerId, peer);
    // Antes de qualquer oferta: o outro lado precisa saber qual vídeo é qual.
    this.signal(peerId, { kind: 'media', camera: this.cameraCarrier.id, screen: this.screenCarrier.id });

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
      if (track.kind === 'video') {
        peer.remoteVideo.set(remote.id, remote);
        this.announceVideo(peerId, peer);
        return;
      }
      // Áudio que não é da tela é o microfone (o som da tela toca pelo <video> de quem assiste).
      if (remote.id !== peer.remoteMedia?.screen) {
        const audio = peer.audio ?? new Audio();
        audio.autoplay = true;
        audio.srcObject = remote;
        audio.muted = this.deafened;
        applyOutput(audio, this.prefs);
        peer.audio = audio;
        this.detector.watch(peerId, remote);
        audio.play().catch(() => {
          // O navegador pode bloquear autoplay; o clique em "entrar" normalmente libera.
        });
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') pc.restartIce();
    };
    return peer;
  }

  /** Avisa os vídeos recebidos cuja origem (câmera ou tela) já é conhecida. */
  private announceVideo(peerId: Id, peer: Peer): void {
    const media = peer.remoteMedia;
    if (!media) return;
    for (const [id, stream] of peer.remoteVideo) {
      if (id === media.camera) this.events.onRemoteCamera?.(peerId, stream);
      else if (id === media.screen) this.events.onRemoteScreen?.(peerId, stream);
    }
  }

  private addLocalAudio(peer: Peer): void {
    const stream = this.localStream;
    stream?.getAudioTracks().forEach((track) => peer.pc.addTrack(track, stream));
    peer.sending = true;
  }

  private async handleSignal(from: Id, signal: SignalPayload): Promise<void> {
    if (!this.localStream) return;
    const peer = this.peers.get(from) ?? this.createPeer(from);
    const { pc } = peer;
    try {
      if (signal.kind === 'media') {
        peer.remoteMedia = { camera: signal.camera, screen: signal.screen };
        this.announceVideo(from, peer);
      } else if (signal.kind === 'description') {
        const { description } = signal;
        const collision = description.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
        peer.ignoreOffer = !peer.polite && collision;
        if (peer.ignoreOffer) return;
        await pc.setRemoteDescription(description); // em colisão, desfaz a oferta local sozinho
        if (description.type === 'offer') {
          // Quem recebe a primeira oferta só adiciona o microfone agora, reaproveitando o
          // transceptor que a oferta criou (antes disso, criaria outro e renegociaria à toa).
          const first = !peer.sending;
          if (first) this.addLocalAudio(peer);
          await pc.setLocalDescription();
          this.sendDescription(from, pc);
          if (first) {
            this.applyScreenViewers();
            this.applyCamera();
          }
        }
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
    this.events.onRemoteCamera?.(peerId, null);
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

export function describeCameraError(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === 'NotAllowedError') return 'Permissão da câmera negada pelo navegador.';
    if (err.name === 'NotFoundError') return 'Nenhuma câmera encontrada.';
    if (err.name === 'NotReadableError') return 'A câmera está em uso por outro programa.';
  }
  return err instanceof Error ? err.message : 'Não foi possível ligar a câmera.';
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

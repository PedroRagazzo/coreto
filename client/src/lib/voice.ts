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
import { withStereoOpus } from '@shared/opus-sdp';
import type { IceServer, SignalPayload } from '@shared/protocol';
import type { ScreenPublishOptions, SfuSession } from './sfu';
import { resolutionScale, viewerBitrate } from '@shared/stream-quality';
import {
  DEFAULT_SETTINGS,
  DEFAULT_USER_VOLUME,
  microphoneConstraints,
  type UserVolume,
  type VoicePrefs,
} from './settings';
import { AppAudioFeed } from './app-audio';
import noiseSuppressorUrl from './noise-suppressor.worklet.js?worker&url';
import { desktop } from './desktop';
import type { AppSocket } from './socket';
import { PreviewCapture } from './stream-preview';

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

/** Decibéis (0 = volume máximo) para amplitude linear, e de volta. */
export const dbToLinear = (db: number) => 10 ** (db / 20);
export const linearToDb = (linear: number) => (linear > 0 ? 20 * Math.log10(linear) : -Infinity);

/** O que o microfone está captando agora, para o medidor da sensibilidade. */
export interface MicLevel {
  /** Nível em dB, antes da porta (o que decide se ela abre). */
  db: number;
  /** A porta está aberta: sua voz está sendo enviada. */
  open: boolean;
}

const GATE_WORKLET_URL = `${import.meta.env.BASE_URL}mic-gate.worklet.js`;

/**
 * Microfone → ganho → (cancelamento de ruído com IA) → porta de ruído → saída fixa. Trocar de microfone só troca a
 * fonte: a faixa enviada às conexões continua a mesma, sem renegociar no meio da chamada.
 * A porta (sensibilidade de entrada) roda na thread de áudio, então continua firme
 * com a janela em segundo plano.
 */
export class MicPipeline {
  /** O RNNoise só trabalha a 48 kHz; o Chrome converte de/para a placa de som. */
  private readonly context = new AudioContext({ sampleRate: 48000 });
  private readonly gain = this.context.createGain();
  private readonly output = this.context.createMediaStreamDestination();
  private gate: AudioWorkletNode | null = null;
  private suppressor: AudioWorkletNode | null = null;
  private aiEnabled = false;
  private source: MediaStreamAudioSourceNode | null = null;
  private raw: MediaStream | null = null;
  /** O que vai para as conexões e para o medidor de fala. */
  readonly stream = this.output.stream;

  private constructor(prefs: VoicePrefs) {
    this.gain.gain.value = prefs.inputVolume;
    void this.context.resume();
  }

  /** Prepara a cadeia de áudio; sem suporte a worklet (ou se ele falhar), o microfone fica sempre aberto. */
  static async create(prefs: VoicePrefs, onLevel?: (level: MicLevel) => void): Promise<MicPipeline> {
    const pipeline = new MicPipeline(prefs);
    try {
      await pipeline.context.audioWorklet.addModule(GATE_WORKLET_URL);
      const gate = new AudioWorkletNode(pipeline.context, 'mic-gate', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      gate.port.onmessage = (event: MessageEvent<{ level: number; open: boolean }>) =>
        onLevel?.({ db: linearToDb(event.data.level), open: event.data.open });
      gate.connect(pipeline.output);
      pipeline.gate = gate;
      pipeline.setSensitivity(prefs);
    } catch (err) {
      console.warn('[voz] sem porta de ruído; microfone sempre aberto', err);
    }
    await pipeline.setAiNoiseSuppression(prefs.aiNoiseSuppression);
    return pipeline;
  }

  /** Para onde o ganho manda o som: a porta de ruído, ou direto à saída se ela não carregou. */
  private get tail(): AudioNode {
    return this.gate ?? this.output;
  }

  /** Liga ou desliga o cancelamento de ruído com IA; se não carregar, o microfone segue sem ele. */
  async setAiNoiseSuppression(enabled: boolean): Promise<void> {
    if (enabled && !this.suppressor) {
      try {
        await this.context.audioWorklet.addModule(noiseSuppressorUrl);
        this.suppressor = new AudioWorkletNode(this.context, 'noise-suppressor', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
        });
      } catch (err) {
        console.warn('[voz] sem cancelamento de ruído com IA', err);
        enabled = false;
      }
    }
    this.aiEnabled = enabled;
    this.gain.disconnect();
    this.suppressor?.disconnect();
    if (enabled && this.suppressor) {
      this.gain.connect(this.suppressor).connect(this.tail);
    } else {
      this.gain.connect(this.tail);
    }
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

  /** Automático = sempre aberto; manual = só passa o que está acima do limite. */
  setSensitivity({ autoSensitivity, inputSensitivity }: Pick<VoicePrefs, 'autoSensitivity' | 'inputSensitivity'>): void {
    this.gate?.port.postMessage({ enabled: !autoSensitivity, threshold: dbToLinear(inputSensitivity) });
  }

  close(): void {
    this.source?.disconnect();
    this.suppressor?.port.postMessage('close');
    this.raw?.getTracks().forEach((track) => track.stop());
    this.stream.getTracks().forEach((track) => track.stop());
    void this.context.close();
  }
}

/**
 * A voz de alguém: o fluxo recebido passa por um ganho (o volume dessa pessoa, só
 * seu, de 0 a 200%) antes de tocar. Quem toca é `output`, que continua valendo para
 * a saída de áudio escolhida, o volume geral e o "ensurdecer".
 */
class RemoteVoice {
  readonly output = new Audio();
  /** O Chrome só entrega o áudio remoto ao Web Audio se o fluxo também estiver ligado a um elemento. */
  private readonly keepAlive = new Audio();
  private readonly source: MediaStreamAudioSourceNode;
  private readonly gain: GainNode;
  private readonly destination: MediaStreamAudioDestinationNode;

  constructor(
    private readonly context: AudioContext,
    remote: MediaStream,
    userVolume: UserVolume,
  ) {
    this.keepAlive.muted = true;
    this.keepAlive.autoplay = true;
    this.keepAlive.srcObject = remote;
    void this.keepAlive.play().catch(() => {});
    this.source = context.createMediaStreamSource(remote);
    this.gain = context.createGain();
    this.gain.gain.value = userVolume.muted ? 0 : userVolume.volume;
    this.destination = context.createMediaStreamDestination();
    this.source.connect(this.gain).connect(this.destination);
    this.output.autoplay = true;
    this.output.srcObject = this.destination.stream;
  }

  setUserVolume({ volume, muted }: UserVolume): void {
    this.gain.gain.setTargetAtTime(muted ? 0 : volume, this.context.currentTime, 0.03);
  }

  close(): void {
    this.source.disconnect();
    this.gain.disconnect();
    this.output.srcObject = null;
    this.keepAlive.srcObject = null;
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
  a.aiNoiseSuppression !== b.aiNoiseSuppression ||
  a.autoGainControl !== b.autoGainControl;

/** Qualidade da transmissão de tela, como no seletor do Discord. */
export interface ScreenShareOptions {
  /** Altura máxima em pixels; `null` = resolução original da tela. */
  height: 720 | 1080 | null;
  frameRate: 15 | 30 | 60;
  /** Pede também o som (o Chrome oferece para abas e para a tela inteira no Windows). */
  audio: boolean;
  /**
   * O que sacrificar quando a internet ou o computador não dão conta: `sharp` mantém a
   * imagem nítida e deixa os quadros caírem (texto, código); `smooth` mantém a fluidez e
   * deixa a imagem perder resolução (jogos, vídeos).
   */
  priority: 'sharp' | 'smooth';
  /** Velocidade de envio (upload) da sua internet em Mbps, dividida entre quem assiste. */
  uploadMbps: 5 | 10 | 20 | 50;
  /**
   * Como o vídeo é codificado no servidor de mídia: H.264 costuma usar a placa de vídeo (60 fps estável em
   * 1080p); VP8 usa o processador. Pela malha P2P o navegador escolhe sozinho.
   */
  codec: 'h264' | 'vp8';
}

/** Este navegador sabe codificar H.264 para transmissão? */
export function supportsH264(): boolean {
  try {
    return (RTCRtpSender.getCapabilities?.('video')?.codecs ?? []).some((c) => c.mimeType.toLowerCase() === 'video/h264');
  } catch {
    return false;
  }
}


/** Câmera leve para caber na malha: cada pessoa envia uma cópia para cada outra. */
const CAMERA_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 640 },
  height: { ideal: 360 },
  frameRate: { ideal: 24, max: 30 },
};
const CAMERA_MAX_BITRATE = 600_000;

/** Como uma transmissão de tela está indo, no último segundo. */
export interface StreamStats {
  role: 'sending' | 'receiving';
  width: number;
  height: number;
  fps: number;
  /** Quilobits por segundo (somando os espectadores, quando você transmite). */
  kbps: number;
  lossPercent: number;
  rttMs: number | null;
  codec: string | null;
  /** Só ao transmitir: o que está limitando a qualidade (`cpu` = seu computador, `bandwidth` = sua internet). */
  limit: 'none' | 'bandwidth' | 'cpu' | 'other' | null;
  /** Só ao transmitir: para quantas pessoas o vídeo está indo. */
  viewers: number;
  /** Por onde a imagem passa: pelo servidor de mídia (uma cópia só) ou direto entre os navegadores (uma cópia por espectador). */
  via: 'sfu' | 'p2p';
  /** Só ao transmitir: quem codifica o vídeo, a placa de vídeo ou o processador (`null` se o navegador não diz). */
  encoder: 'hardware' | 'software' | null;
}

function codecName(report: RTCStatsReport, codecId: unknown): string | null {
  const codec = typeof codecId === 'string' ? (report.get(codecId) as { mimeType?: string } | undefined) : undefined;
  return codec?.mimeType?.replace(/^video\//, '') ?? null;
}

/** A placa de vídeo codifica? O navegador diz pelo nome do codificador ou pela marca de eficiência de energia. */
function encoderKind(outbound: Record<string, unknown>): StreamStats['encoder'] {
  if (outbound['powerEfficientEncoder'] === true) return 'hardware';
  const impl = String(outbound['encoderImplementation'] ?? '');
  if (!impl) return null;
  return /MediaFoundation|VideoToolbox|Nvenc|NVENC|VAAPI|V4L2|Hardware|External/i.test(impl) ? 'hardware' : 'software';
}

/** Ida e volta (ms) do par de rede em uso. */
function currentRoundTrip(report: RTCStatsReport): number | null {
  let rtt: number | null = null;
  report.forEach((stat) => {
    if (stat.type === 'candidate-pair' && stat.nominated && stat.state === 'succeeded' && Number.isFinite(stat.currentRoundTripTime)) {
      rtt = stat.currentRoundTripTime * 1000;
    }
  });
  return rtt;
}

export interface VoiceEvents {
  /** Quem está falando agora (incluindo você), a cada mudança. */
  onSpeaking?: (speaking: Set<Id>) => void;
  /** A tela de alguém começou a chegar (ou parou de existir, com `null`). */
  onRemoteScreen?: (userId: Id, stream: MediaStream | null) => void;
  /** A câmera de alguém começou a chegar (ou parou de existir, com `null`). */
  onRemoteCamera?: (userId: Id, stream: MediaStream | null) => void;
  /** Você parou de compartilhar pelo próprio navegador (botão "Parar de compartilhar"). */
  onScreenEnded?: () => void;
  /** Esta pessoa é um robô (o bot de música)? Com ele, a conexão pede áudio em estéreo e com mais qualidade. */
  isBot?: (userId: Id) => boolean;
}

interface Peer {
  pc: RTCPeerConnection;
  /** "Perfect negotiation": em colisão de ofertas, o lado educado cede. */
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  voice: RemoteVoice | null;
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

/**
 * O nome do que está sendo compartilhado, para a lista da sala: no app de desktop vem do seletor
 * ("Tela 1", o título da janela); no navegador, do rótulo da faixa, quando ele diz alguma coisa.
 */
async function captureTitle(video: MediaStreamTrack): Promise<string> {
  const fromApp = await desktop?.getCaptureName?.().catch(() => null);
  if (fromApp) return fromApp;
  const label = video.label.trim();
  return label && !/^(screen|window|web-contents-media-stream|browser):/i.test(label) ? label : 'Tela compartilhada';
}

export class VoiceManager {
  private localStream: MediaStream | null = null;
  private mic: MicPipeline | null = null;
  /** Onde as vozes recebidas passam pelo volume de cada pessoa; existe só durante a chamada. */
  private playback: AudioContext | null = null;
  private prefs: VoicePrefs = DEFAULT_SETTINGS.voice;
  private iceServers: IceServer[] = [];
  private iceTransportPolicy: RTCIceTransportPolicy = 'all';
  private readonly peers = new Map<Id, Peer>();
  private deafened = false;
  private selfId: Id | null = null;
  private readonly detector: SpeakingDetector;
  /**
   * `transport` diz por onde a tela sai: `pending` enquanto tenta o servidor de mídia (ninguém recebe
   * pela malha nesse meio-tempo, para a imagem não chegar duas vezes), `sfu` quando já está lá, `p2p`
   * quando não há servidor de mídia ou ele falhou.
   */
  private screen: {
    stream: MediaStream;
    options: ScreenShareOptions;
    feed: AppAudioFeed | null;
    preview: PreviewCapture;
    transport: 'pending' | 'sfu' | 'p2p';
    /** O servidor de mídia caiu por um instante e a tela está na malha até ele voltar. */
    sfuInterrupted?: boolean;
  } | null = null;
  /** As telas que chegam de outras pessoas, por onde chegam, e a que cada pessoa está vendo agora. */
  private readonly remoteScreens = { sfu: new Map<Id, MediaStream>(), p2p: new Map<Id, MediaStream>() };
  private readonly shownScreens = new Map<Id, MediaStream>();
  private sfuInterruptedForViewing = false;
  /** O servidor avisou, ao entrar, que há servidor de mídia para as transmissões. */
  private sfuAvailable = false;
  private sfuSession: SfuSession | null = null;
  private sfuConnecting: Promise<SfuSession | null> | null = null;
  /** De quem você assiste a tela agora (segundo o servidor). */
  private watchedScreens: Id[] = [];
  private camera: MediaStream | null = null;
  /** Fluxos fixos onde câmera e tela viajam; os ids são anunciados a cada pessoa. */
  private cameraCarrier = new MediaStream();
  private screenCarrier = new MediaStream();
  /** Fila das mudanças de qualidade com a transmissão no ar. */
  private screenUpdates: Promise<void> = Promise.resolve();
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
    // Tudo que leva tempo fica antes de entrar na sala: depois do aviso ao servidor, quem
    // chega já pode ligar para nós, e sinais recebidos antes de estarmos prontos se perderiam.
    const mic = await MicPipeline.create(this.prefs);
    mic.use(raw);
    const playback = new AudioContext();
    void playback.resume();
    const res = await this.socket.emitWithAck('voice:join', { channelId });
    if (!res.ok) {
      mic.close();
      void playback.close();
      throw new Error(res.error);
    }
    this.mic = mic;
    this.playback = playback;
    const stream = mic.stream;
    this.localStream = stream;
    this.cameraCarrier = new MediaStream();
    this.screenCarrier = new MediaStream();
    this.iceServers = res.data.iceServers;
    this.iceTransportPolicy = res.data.iceTransportPolicy;
    this.sfuAvailable = res.data.sfu;
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
    this.closeSfu();
    this.remoteScreens.sfu.clear();
    this.remoteScreens.p2p.clear();
    this.shownScreens.clear();
    this.sfuInterruptedForViewing = false;
    this.sfuAvailable = false;
    this.watchedScreens = [];
    if (this.selfId) this.detector.unwatch(this.selfId);
    this.detector.stop();
    this.mic?.close();
    this.mic = null;
    void this.playback?.close();
    this.playback = null;
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
      if (next.aiNoiseSuppression !== prev.aiNoiseSuppression) await this.mic.setAiNoiseSuppression(next.aiNoiseSuppression);
      if (next.autoSensitivity !== prev.autoSensitivity || next.inputSensitivity !== prev.inputSensitivity) {
        this.mic.setSensitivity(next);
      }
      if (micChanged(prev, next)) this.mic.use(await openMicrophone(next));
    }
    if (next.outputDeviceId !== prev.outputDeviceId || next.outputVolume !== prev.outputVolume) {
      for (const peer of this.peers.values()) if (peer.voice) applyOutput(peer.voice.output, next);
    }
    if (next.userVolumes !== prev.userVolumes) {
      for (const [peerId, peer] of this.peers) peer.voice?.setUserVolume(next.userVolumes[peerId] ?? DEFAULT_USER_VOLUME);
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
    for (const peer of this.peers.values()) if (peer.voice) peer.voice.output.muted = deafened;
  }

  // ── Compartilhamento de tela ───────────────────────────────────────────────

  /**
   * Abre o seletor de tela do navegador. Chame direto do clique (o navegador
   * exige um gesto). Ninguém recebe nada até `setScreenViewers` dizer quem assiste.
   */
  async startScreen(options: ScreenShareOptions): Promise<{ stream: MediaStream; audioFailed: boolean; title: string }> {
    if (!this.localStream) throw new Error('Entre em um canal de voz para compartilhar a tela.');
    const constraints: MediaTrackConstraints = {
      frameRate: { ideal: options.frameRate, max: options.frameRate },
      ...(options.height && { height: { ideal: options.height, max: options.height } }),
    };
    let stream: MediaStream;
    let audioFailed = false;
    // No app de desktop do Windows o som vem do helper (só o do programa escolhido), não do navegador.
    let feed = options.audio && desktop?.appAudio ? new AppAudioFeed(desktop.appAudio) : null;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: constraints, audio: options.audio });
    } catch (err) {
      feed?.close();
      feed = null;
      // Alguns sistemas não liberam o som (no app de desktop, "Could not start audio source"):
      // em vez de falhar, transmite só a imagem.
      if (!options.audio || !(err instanceof DOMException) || err.name !== 'NotReadableError') throw err;
      stream = await navigator.mediaDevices.getDisplayMedia({ video: constraints, audio: false });
      audioFailed = true;
    }
    if (feed) {
      const session = stream.getAudioTracks().length === 0 ? await desktop?.appAudio?.active() : null;
      if (session == null) {
        feed.close();
        feed = null;
        audioFailed = true;
      } else {
        feed.sessionId = session;
        stream.addTrack(await feed.track());
      }
    }
    this.stopScreen();
    const [video] = stream.getVideoTracks();
    // Dica para o codificador: "text" mantém a resolução e cai nos quadros; "motion" faz o contrário.
    video.contentHint = options.priority === 'sharp' ? 'text' : 'motion';
    // O usuário pode parar pelo aviso do próprio navegador.
    video.addEventListener('ended', () => {
      if (this.screen?.stream === stream) this.events.onScreenEnded?.();
    });
    const preview = new PreviewCapture(stream, (image) => this.socket.emit('stream:preview', { image }));
    const screen = { stream, options, feed, preview, transport: this.sfuAvailable ? ('pending' as const) : ('p2p' as const) };
    this.screen = screen;
    this.applyScreenViewers();
    if (this.sfuAvailable) void this.publishViaSfu(screen);
    return { stream, audioFailed, title: await captureTitle(video) };
  }

  /**
   * Tenta mandar a tela pelo servidor de mídia. Se ele não responde, a tela segue pela malha P2P,
   * como sem servidor de mídia nenhum: ninguém fica sem imagem.
   */
  private async publishViaSfu(screen: NonNullable<VoiceManager['screen']>): Promise<void> {
    const stillMine = () => this.screen === screen;
    try {
      const session = await this.connectSfu();
      const [video] = screen.stream.getVideoTracks();
      const [audio] = screen.stream.getAudioTracks();
      if (!session || !video || !stillMine()) throw new Error(session ? 'a transmissão acabou' : 'sem conexão com o servidor de mídia');
      await session.publishScreen(video, audio ?? null, this.sfuPublishOptions(screen.options));
      if (!stillMine()) {
        void session.unpublishScreen();
        return;
      }
      screen.transport = 'sfu';
    } catch (err) {
      if (!stillMine()) return;
      console.warn('[voz] servidor de mídia indisponível; a tela vai pela malha P2P', err);
      screen.transport = 'p2p';
    }
    this.applyScreenViewers();
  }

  private sfuPublishOptions(options: ScreenShareOptions): ScreenPublishOptions {
    return {
      maxBitrate: viewerBitrate(options, 1),
      maxFramerate: options.frameRate,
      priority: options.priority,
      codec: options.codec === 'h264' && supportsH264() ? 'h264' : 'vp8',
    };
  }

  /** Entra (uma vez por chamada) na sala do servidor de mídia; `null` se ele não responde. */
  private connectSfu(): Promise<SfuSession | null> {
    if (this.sfuSession) return Promise.resolve(this.sfuSession);
    this.sfuConnecting ??= (async () => {
      try {
        const res = await this.socket.emitWithAck('sfu:token');
        if (!res.ok) throw new Error(res.error);
        const { SfuSession } = await import('./sfu');
        const session = await SfuSession.connect(res.data, {
          rtcConfig: { iceServers: this.iceServers, iceTransportPolicy: this.iceTransportPolicy },
          onScreen: (userId, stream) => this.setRemoteScreen('sfu', userId, stream),
          onClosed: () => this.sfuClosed(session),
          onReconnecting: () => this.sfuInterrupted(session, true),
          onReconnected: () => this.sfuInterrupted(session, false),
        });
        if (!this.sfuAvailable) {
          session.close(); // saiu da chamada enquanto conectava
          return null;
        }
        this.sfuSession = session;
        session.watch(this.watchedScreens);
        return session;
      } catch (err) {
        console.warn('[voz] não foi possível entrar no servidor de mídia', err);
        return null;
      } finally {
        this.sfuConnecting = null;
      }
    })();
    return this.sfuConnecting;
  }

  /** A conexão com o servidor de mídia caiu de vez: a tela, se estava lá, volta para a malha P2P. */
  private sfuClosed(session: SfuSession): void {
    if (this.sfuSession !== session) return;
    this.sfuSession = null;
    if (this.screen?.transport === 'sfu' || this.screen?.sfuInterrupted) {
      this.screen.transport = 'p2p';
      this.screen.sfuInterrupted = false;
      this.applyScreenViewers();
    }
  }

  /**
   * O servidor de mídia ficou fora do ar por um instante (e o LiveKit tenta voltar): enquanto isso a tela
   * segue pela malha P2P para ninguém ficar com a imagem congelada, e volta para o servidor quando ele volta.
   */
  private sfuInterrupted(session: SfuSession, interrupted: boolean): void {
    if (this.sfuSession !== session) return;
    this.sfuInterruptedForViewing = interrupted;
    for (const userId of new Set([...this.remoteScreens.sfu.keys(), ...this.remoteScreens.p2p.keys()])) this.showBestScreen(userId);
    const screen = this.screen;
    if (!screen) return;
    if (interrupted && screen.transport === 'sfu') {
      screen.transport = 'p2p';
      screen.sfuInterrupted = true;
      this.applyScreenViewers();
    } else if (!interrupted && screen.sfuInterrupted) {
      screen.transport = 'sfu';
      screen.sfuInterrupted = false;
      this.applyScreenViewers();
    }
  }

  /**
   * A tela de alguém chega pelo servidor de mídia, pela malha P2P ou pelas duas (numa troca de uma para
   * a outra). Quem vê só recebe uma: a do servidor de mídia, se existe, senão a da malha.
   */
  private setRemoteScreen(source: 'sfu' | 'p2p', userId: Id, stream: MediaStream | null): void {
    const sources = this.remoteScreens[source];
    if (stream) sources.set(userId, stream);
    else sources.delete(userId);
    this.showBestScreen(userId);
  }

  private showBestScreen(userId: Id): void {
    // Com o servidor de mídia fora do ar o que ele mostra está congelado: vale a malha, se ela tem imagem.
    const fromSfu = this.sfuInterruptedForViewing ? undefined : this.remoteScreens.sfu.get(userId);
    const best = fromSfu ?? this.remoteScreens.p2p.get(userId) ?? null;
    if ((this.shownScreens.get(userId) ?? null) === best) return;
    if (best) this.shownScreens.set(userId, best);
    else this.shownScreens.delete(userId);
    this.events.onRemoteScreen?.(userId, best);
  }

  private closeSfu(): void {
    const session = this.sfuSession;
    this.sfuSession = null;
    this.sfuConnecting = null;
    session?.close();
  }

  /** Avisa de quem você assiste a tela (lista vazia = ninguém); é daí que vem a imagem do servidor de mídia. */
  setWatching(userIds: Id[]): void {
    this.watchedScreens = userIds;
    if (!this.sfuAvailable) return;
    if (this.sfuSession) this.sfuSession.watch(userIds);
    else if (userIds.length > 0) void this.connectSfu();
  }

  /** As opções da transmissão em andamento, ou `null` se você não está transmitindo. */
  screenOptions(): ScreenShareOptions | null {
    return this.screen ? { ...this.screen.options } : null;
  }

  /**
   * Muda a qualidade com a transmissão no ar: a captura passa a entregar a nova altura e os novos
   * quadros, a dica de prioridade vai para o codificador, e o bitrate de cada espectador é
   * recalculado. Ninguém renegocia nem perde a imagem. Devolve as opções agora valendo, ou `null`
   * se a transmissão já acabou.
   */
  async updateScreen(
    patch: Partial<Pick<ScreenShareOptions, 'height' | 'frameRate' | 'priority' | 'uploadMbps' | 'codec'>>,
  ): Promise<ScreenShareOptions | null> {
    const screen = this.screen;
    if (!screen) return null;
    const codecChanged = patch.codec !== undefined && patch.codec !== screen.options.codec;
    screen.options = { ...screen.options, ...patch };
    // Uma mudança de cada vez, sempre com as opções mais recentes: trocar várias coisas seguidas não pode
    // deixar a captura de uma e o envio de outra.
    const run = async (): Promise<ScreenShareOptions | null> => {
      if (this.screen !== screen) return null;
      const { options } = screen;
      const [video] = screen.stream.getVideoTracks();
      video.contentHint = options.priority === 'sharp' ? 'text' : 'motion';
      // Sem `height`, a captura volta ao tamanho original da tela. Se o sistema não aceitar mudar a captura,
      // o limite de quadros e o de resolução do envio (abaixo) continuam valendo.
      await video
        .applyConstraints({
          frameRate: { ideal: options.frameRate, max: options.frameRate },
          ...(options.height && { height: { ideal: options.height, max: options.height } }),
        })
        .catch((err: unknown) => console.warn('[voz] applyConstraints', err));
      if (this.screen !== screen) return null; // parou enquanto a captura mudava
      // O codec é escolhido ao publicar: trocar no ar é publicar de novo (a imagem some um instante para quem assiste).
      if (codecChanged && screen.transport === 'sfu' && this.sfuSession) {
        const [audio] = screen.stream.getAudioTracks();
        await this.sfuSession
          .publishScreen(video, audio ?? null, this.sfuPublishOptions(options))
          .catch((err: unknown) => console.warn('[voz] republicar com outro codec', err));
        if (this.screen !== screen) return null;
      }
      this.applyScreenViewers();
      return { ...screen.options };
    };
    const result = this.screenUpdates.then(run, run);
    this.screenUpdates = result.then(() => undefined, () => undefined);
    return result;
  }

  stopScreen(): void {
    if (!this.screen) return;
    this.screen.stream.getTracks().forEach((track) => track.stop());
    this.screen.feed?.close();
    this.screen.preview.stop();
    this.screen = null;
    void this.sfuSession?.unpublishScreen();
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
    // Pelo servidor de mídia (ou a caminho dele), a malha P2P não manda a tela a ninguém.
    const direct = (this.screen?.transport ?? 'p2p') === 'p2p';
    const p2pViewers = direct ? this.screenViewers : new Set<Id>();
    const viewers = [...this.peers.keys()].filter((id) => p2pViewers.has(id)).length;
    // Na malha o upload se divide entre os espectadores; no servidor de mídia sai uma cópia só.
    const bitrate = options ? viewerBitrate(options, direct ? viewers : 1) : 0;
    const encodings: RTCRtpEncodingParameters[] =
      options && video
        ? [
            {
              maxBitrate: bitrate,
              maxFramerate: options.frameRate,
              scaleResolutionDownBy: resolutionScale(video.getSettings().height ?? 0, bitrate, options.frameRate),
            },
          ]
        : [];
    for (const [peerId, peer] of this.peers) {
      const watching = this.screen !== null && p2pViewers.has(peerId);
      this.sendTrack(peer, 'screenVideo', watching ? video : null, this.screenCarrier, encodings);
      this.sendTrack(peer, 'screenAudio', watching ? audio : null, this.screenCarrier, []);
    }
    const sender = this.screen?.transport === 'sfu' ? this.sfuSession?.videoSender : null;
    if (sender && encodings.length && options) {
      void this.updateEncoding(sender, encodings[0], options.priority === 'sharp' ? 'maintain-resolution' : 'maintain-framerate');
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

  private async updateEncoding(
    sender: RTCRtpSender,
    encoding: RTCRtpEncodingParameters,
    degradationPreference?: RTCDegradationPreference,
  ): Promise<void> {
    const params = sender.getParameters();
    if (!params.encodings?.length) return;
    if (degradationPreference) params.degradationPreference = degradationPreference;
    params.encodings[0].maxBitrate = encoding.maxBitrate;
    params.encodings[0].maxFramerate = encoding.maxFramerate;
    if (encoding.scaleResolutionDownBy !== undefined) params.encodings[0].scaleResolutionDownBy = encoding.scaleResolutionDownBy;
    await sender.setParameters(params).catch((err: unknown) => console.warn('[voz] setParameters', err));
  }

  // ── Estatísticas da transmissão ────────────────────────────────────────────

  /** Última leitura de bytes e quadros, para calcular por segundo. */
  private readonly statSamples = new Map<string, { at: number; bytes: number; frames: number }>();

  /**
   * Como a transmissão de `userId` está indo, lida das estatísticas do WebRTC: a sua (o que sai,
   * somado entre os espectadores) ou a de quem você assiste (o que chega). `null` se não há nada.
   * Os valores por segundo vêm da diferença para a leitura anterior, então chame a cada segundo.
   */
  async screenStats(userId: Id): Promise<StreamStats | null> {
    return userId === this.selfId ? this.sendingStats() : this.receivingStats(userId);
  }

  private rate(key: string, bytes: number, frames: number): { kbps: number; fps: number } {
    const at = performance.now();
    const before = this.statSamples.get(key);
    this.statSamples.set(key, { at, bytes, frames });
    if (!before || at <= before.at) return { kbps: 0, fps: 0 };
    const seconds = (at - before.at) / 1000;
    return { kbps: Math.max(0, ((bytes - before.bytes) * 8) / 1000 / seconds), fps: Math.max(0, (frames - before.frames) / seconds) };
  }

  private async receivingStats(userId: Id): Promise<StreamStats | null> {
    // Pelo servidor de mídia a imagem não vem da conexão com a pessoa, mas da conexão com o servidor.
    const sfuReceiver = this.sfuInterruptedForViewing ? null : (this.sfuSession?.receiverFor(userId) ?? null);
    const peer = this.peers.get(userId);
    const screenId = peer?.remoteMedia?.screen;
    const track = screenId ? peer?.remoteVideo.get(screenId)?.getVideoTracks()[0] : undefined;
    const receiver = sfuReceiver ?? (track && peer?.pc.getReceivers().find((r) => r.track === track));
    if (!receiver || (!sfuReceiver && !peer)) return null;

    const report = await receiver.getStats();
    const all = sfuReceiver || !peer ? report : await peer.pc.getStats();
    let inbound: Record<string, unknown> | undefined;
    report.forEach((stat) => {
      if (stat.type === 'inbound-rtp' && stat.kind === 'video') inbound = stat;
    });
    if (!inbound) return null;
    const received = Number(inbound['packetsReceived'] ?? 0);
    const lost = Number(inbound['packetsLost'] ?? 0);
    const { kbps, fps } = this.rate(`in:${userId}`, Number(inbound['bytesReceived'] ?? 0), Number(inbound['framesDecoded'] ?? 0));
    return {
      role: 'receiving',
      width: Number(inbound['frameWidth'] ?? 0),
      height: Number(inbound['frameHeight'] ?? 0),
      fps,
      kbps,
      lossPercent: received + lost > 0 ? (lost / (received + lost)) * 100 : 0,
      rttMs: currentRoundTrip(all),
      codec: codecName(report, inbound['codecId']),
      limit: null,
      viewers: 0,
      via: sfuReceiver ? 'sfu' : 'p2p',
      encoder: null,
    };
  }

  private async sendingStats(): Promise<StreamStats | null> {
    if (!this.screen) return null;
    let width = 0;
    let height = 0;
    let fps = 0;
    let kbps = 0;
    let loss = 0;
    let rtt: number | null = null;
    let codec: string | null = null;
    let encoder: StreamStats['encoder'] = null;
    let worst = 0; // índice em `limits`: o pior limite entre os espectadores
    let viewers = 0;
    const limits = ['none', 'other', 'bandwidth', 'cpu'] as const;

    // Pelo servidor de mídia há um emissor só; pela malha, um por espectador.
    const via = this.screen.transport === 'sfu' ? 'sfu' : 'p2p';
    const senders: { key: string; sender: RTCRtpSender }[] = [];
    if (via === 'sfu') {
      const sender = this.sfuSession?.videoSender;
      if (sender) senders.push({ key: 'out:sfu', sender });
    } else {
      for (const [peerId, peer] of this.peers) {
        const sender = peer.screenVideo?.sender;
        if (sender?.track && this.screenViewers.has(peerId)) senders.push({ key: `out:${peerId}`, sender });
      }
    }

    for (const { key, sender } of senders) {
      const report = await sender.getStats();
      let outbound: Record<string, unknown> | undefined;
      let remote: Record<string, unknown> | undefined;
      report.forEach((stat) => {
        if (stat.type === 'outbound-rtp' && stat.kind === 'video') outbound = stat;
        if (stat.type === 'remote-inbound-rtp' && stat.kind === 'video') remote = stat;
      });
      if (!outbound) continue;
      viewers++;
      const rate = this.rate(key, Number(outbound['bytesSent'] ?? 0), Number(outbound['framesEncoded'] ?? 0));
      kbps += rate.kbps;
      fps = Math.max(fps, rate.fps);
      width = Math.max(width, Number(outbound['frameWidth'] ?? 0));
      height = Math.max(height, Number(outbound['frameHeight'] ?? 0));
      codec ??= codecName(report, outbound['codecId']);
      encoder ??= encoderKind(outbound);
      const reason = String(outbound['qualityLimitationReason'] ?? 'none');
      worst = Math.max(worst, reason === 'none' ? 0 : reason === 'cpu' ? 3 : reason === 'bandwidth' ? 2 : 1);
      if (remote) {
        const sent = Number(outbound['packetsSent'] ?? 0);
        const lost = Number(remote['packetsLost'] ?? 0);
        if (sent > 0) loss = Math.max(loss, (Math.max(0, lost) / sent) * 100);
        const round = Number(remote['roundTripTime'] ?? NaN);
        if (Number.isFinite(round)) rtt = Math.max(rtt ?? 0, round * 1000);
      }
    }
    // No servidor de mídia o emissor é um só, então quem assiste vem da lista da sala.
    if (via === 'sfu' && viewers > 0) viewers = [...this.screenViewers].filter((id) => id !== this.selfId).length;
    return { role: 'sending', width, height, fps, kbps, lossPercent: loss, rttMs: rtt, codec, limit: limits[worst], viewers, via, encoder };
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
      voice: null,
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
        await this.describeLocally(peerId, pc);
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
      if (remote.id !== peer.remoteMedia?.screen && this.playback) {
        peer.voice?.close();
        const voice = new RemoteVoice(this.playback, remote, this.prefs.userVolumes[peerId] ?? DEFAULT_USER_VOLUME);
        voice.output.muted = this.deafened;
        applyOutput(voice.output, this.prefs);
        peer.voice = voice;
        this.detector.watch(peerId, remote);
        voice.output.play().catch(() => {
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
      else if (id === media.screen) this.setRemoteScreen('p2p', peerId, stream);
    }
  }

  /**
   * O mesmo que `pc.setLocalDescription()` (oferta ou resposta, conforme o estado). Com o bot de música, o SDP
   * pede Opus em estéreo e a 128 kbps: sem isso o navegador decodifica a música em mono. Com as pessoas, a voz
   * continua mono (pedir estéreo dobraria o envio do microfone à toa).
   */
  private async describeLocally(peerId: Id, pc: RTCPeerConnection): Promise<void> {
    if (!this.events.isBot?.(peerId)) return pc.setLocalDescription();
    const description = pc.signalingState === 'have-remote-offer' ? await pc.createAnswer() : await pc.createOffer();
    await pc.setLocalDescription({ type: description.type, sdp: withStereoOpus(description.sdp ?? '') });
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
          await this.describeLocally(from, pc);
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
    peer.voice?.close();
    this.detector.unwatch(peerId);
    this.peers.delete(peerId);
    this.setRemoteScreen('p2p', peerId, null);
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

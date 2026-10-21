// O bot de música como participante de uma sala de voz. A chamada é ponto a ponto (cada pessoa liga
// para cada outra), então o bot precisa fazer o mesmo que um navegador: uma conexão WebRTC com cada
// pessoa da sala, negociada pelos mesmos sinais (`voice:signal`) e pela mesma regra de colisão
// ("perfect negotiation", como em client/src/lib/voice.ts). Só envia áudio: um fluxo único,
// alimentado quadro a quadro, compartilhado por todas as conexões.

import type { Id } from '../../../shared/src/models.js';
import type { IceCandidate, IceServer, SessionDescription, SignalPayload } from '../../../shared/src/protocol.js';
import { SAMPLE_RATE } from './source.js';

// Só o que usamos do @roamhq/wrtc, para não puxar a biblioteca "DOM" para o servidor.
interface WrtcTrack {
  stop(): void;
}
interface WrtcAudioSource {
  createTrack(): WrtcTrack;
  onData(data: { samples: Int16Array; sampleRate: number; bitsPerSample: number; channelCount: number; numberOfFrames: number }): void;
}
interface WrtcPeerConnection {
  signalingState: string;
  connectionState: string;
  localDescription: SessionDescription | null;
  onnegotiationneeded: (() => void) | null;
  onicecandidate: ((event: { candidate: (IceCandidate & { candidate: string }) | null }) => void) | null;
  onconnectionstatechange: (() => void) | null;
  addTrack(track: WrtcTrack): unknown;
  createOffer(): Promise<SessionDescription>;
  createAnswer(): Promise<SessionDescription>;
  setLocalDescription(description?: SessionDescription | { type: 'rollback' }): Promise<void>;
  setRemoteDescription(description: SessionDescription): Promise<void>;
  addIceCandidate(candidate: IceCandidate): Promise<void>;
  restartIce(): void;
  close(): void;
}
export interface Wrtc {
  RTCPeerConnection: new (config: { iceServers: IceServer[]; iceTransportPolicy: 'all' | 'relay' }) => WrtcPeerConnection;
  nonstandard: { RTCAudioSource: new () => WrtcAudioSource };
}

/** Carrega o WebRTC nativo só quando o bot é usado; se a plataforma não tiver o binário, o servidor segue sem música. */
export async function loadWrtc(): Promise<Wrtc> {
  const module = (await import('@roamhq/wrtc')) as unknown as { default?: Wrtc } & Wrtc;
  return module.default ?? module;
}

interface Peer {
  pc: WrtcPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  /** O áudio do bot já foi ligado a esta conexão. */
  sending: boolean;
}

export interface BotVoiceOptions {
  wrtc: Wrtc;
  botId: Id;
  iceServers: IceServer[];
  iceTransportPolicy: 'all' | 'relay';
  sendSignal(to: Id, signal: SignalPayload): void;
}

export class BotVoice {
  private readonly source: WrtcAudioSource;
  private readonly track: WrtcTrack;
  private readonly peers = new Map<Id, Peer>();
  private signals: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(private readonly options: BotVoiceOptions) {
    this.source = new options.wrtc.nonstandard.RTCAudioSource();
    this.track = this.source.createTrack();
  }

  get peerCount(): number {
    return this.peers.size;
  }

  /** Quem entra liga para quem já estava: o bot liga para as pessoas que estão na sala. */
  join(peerIds: Iterable<Id>): void {
    for (const id of peerIds) this.attach(this.connect(id));
  }

  /** Um quadro de 10 ms (480 amostras, mono, 48 kHz) para todo mundo. */
  pushFrame(samples: Int16Array): void {
    if (this.closed || this.peers.size === 0) return;
    this.source.onData({ samples, sampleRate: SAMPLE_RATE, bitsPerSample: 16, channelCount: 1, numberOfFrames: samples.length });
  }

  handleSignal(from: Id, signal: SignalPayload): void {
    this.signals = this.signals.then(() => this.process(from, signal)).catch((err: unknown) => console.warn('[música] sinalização', from, err));
  }

  closePeer(id: Id): void {
    const peer = this.peers.get(id);
    if (!peer) return;
    this.peers.delete(id);
    peer.pc.onnegotiationneeded = null;
    peer.pc.onicecandidate = null;
    peer.pc.onconnectionstatechange = null;
    peer.pc.close();
  }

  close(): void {
    this.closed = true;
    for (const id of [...this.peers.keys()]) this.closePeer(id);
    this.track.stop();
  }

  private connect(peerId: Id): Peer {
    const { wrtc, botId, iceServers, iceTransportPolicy } = this.options;
    const pc = new wrtc.RTCPeerConnection({ iceServers, iceTransportPolicy });
    const peer: Peer = { pc, polite: botId < peerId, makingOffer: false, ignoreOffer: false, sending: false };
    this.peers.set(peerId, peer);
    // Antes de qualquer oferta: o outro lado precisa saber qual fluxo é câmera e qual é tela (o bot não manda vídeo).
    this.options.sendSignal(peerId, { kind: 'media', camera: 'musica-camera', screen: 'musica-tela' });

    pc.onnegotiationneeded = () => {
      void (async () => {
        try {
          peer.makingOffer = true;
          await pc.setLocalDescription(await pc.createOffer());
          this.sendDescription(peerId, pc);
        } catch (err) {
          console.warn('[música] falha ao negociar com', peerId, err);
        } finally {
          peer.makingOffer = false;
        }
      })();
    };
    pc.onicecandidate = ({ candidate }) => {
      if (!candidate) return;
      const { candidate: line, sdpMid, sdpMLineIndex, usernameFragment } = candidate;
      this.options.sendSignal(peerId, { kind: 'candidate', candidate: { candidate: line, sdpMid, sdpMLineIndex, usernameFragment } });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') pc.restartIce();
    };
    return peer;
  }

  /** Liga o áudio do bot à conexão. Quando é o bot que liga, isso dispara a primeira oferta. */
  private attach(peer: Peer): void {
    if (peer.sending) return;
    peer.pc.addTrack(this.track);
    peer.sending = true;
  }

  private async process(from: Id, signal: SignalPayload): Promise<void> {
    if (this.closed) return;
    if (signal.kind === 'media') return;
    const existing = this.peers.get(from);
    // Quem chega depois liga para o bot: a conexão nasce da oferta, e o áudio é ligado na resposta.
    const peer = existing ?? this.connect(from);
    const { pc } = peer;

    if (signal.kind === 'candidate') {
      try {
        await pc.addIceCandidate(signal.candidate);
      } catch (err) {
        if (!peer.ignoreOffer) throw err;
      }
      return;
    }

    const { description } = signal;
    const collision = description.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
    peer.ignoreOffer = !peer.polite && collision;
    if (peer.ignoreOffer) return;
    if (collision) await pc.setLocalDescription({ type: 'rollback' });
    await pc.setRemoteDescription(description);
    if (description.type === 'offer') {
      this.attach(peer);
      await pc.setLocalDescription(await pc.createAnswer());
      this.sendDescription(from, pc);
    }
  }

  private sendDescription(peerId: Id, pc: WrtcPeerConnection): void {
    const description = pc.localDescription;
    if (description?.type !== 'offer' && description?.type !== 'answer') return;
    this.options.sendSignal(peerId, { kind: 'description', description: { type: description.type, sdp: description.sdp } });
  }
}

// Cliente de voz em malha P2P: uma RTCPeerConnection por participante.
// Quem entra na sala envia a oferta para cada participante que já estava lá.

import type { Id } from '@shared/models';
import type { IceCandidate, IceServer, SignalPayload } from '@shared/protocol';
import type { AppSocket } from './socket';

interface Peer {
  pc: RTCPeerConnection;
  /** Candidatos que chegaram antes da descrição remota. */
  pendingCandidates: IceCandidate[];
  audio: HTMLAudioElement | null;
}

export class VoiceManager {
  private localStream: MediaStream | null = null;
  private iceServers: IceServer[] = [];
  private readonly peers = new Map<Id, Peer>();
  private deafened = false;

  constructor(private readonly socket: AppSocket) {
    socket.on('voice:signal', ({ from, signal }) => void this.handleSignal(from, signal));
    socket.on('voice:peer-left', ({ userId }) => this.closePeer(userId));
  }

  async join(channelId: Id, startMuted: boolean): Promise<void> {
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
    this.setMuted(startMuted);
    await Promise.all(res.data.peers.map((peerId) => this.call(peerId)));
  }

  leave(): void {
    if (!this.localStream) return;
    this.socket.emit('voice:leave');
    this.teardown();
  }

  /** Encerra tudo localmente sem avisar o servidor (ele já encerrou ou caiu). */
  teardown(): void {
    for (const peerId of [...this.peers.keys()]) this.closePeer(peerId);
    this.localStream?.getTracks().forEach((track) => track.stop());
    this.localStream = null;
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

  private async call(peerId: Id): Promise<void> {
    const { pc } = this.createPeer(peerId);
    await pc.setLocalDescription(await pc.createOffer());
    this.sendDescription(peerId, pc);
  }

  private createPeer(peerId: Id): Peer {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const peer: Peer = { pc, pendingCandidates: [], audio: null };
    this.peers.set(peerId, peer);

    const stream = this.localStream;
    stream?.getTracks().forEach((track) => pc.addTrack(track, stream));

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.signal(peerId, { kind: 'candidate', candidate: candidate.toJSON() });
    };
    pc.ontrack = ({ streams: [remote] }) => {
      if (!remote) return;
      const audio = peer.audio ?? new Audio();
      audio.autoplay = true;
      audio.srcObject = remote;
      audio.muted = this.deafened;
      peer.audio = audio;
      audio.play().catch(() => {
        // O navegador pode bloquear autoplay; o clique em "entrar" normalmente libera.
      });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') this.closePeer(peerId);
    };
    return peer;
  }

  private async handleSignal(from: Id, signal: SignalPayload): Promise<void> {
    if (!this.localStream) return;
    const peer = this.peers.get(from) ?? this.createPeer(from);
    const { pc } = peer;
    try {
      if (signal.kind === 'description') {
        await pc.setRemoteDescription(signal.description);
        for (const candidate of peer.pendingCandidates.splice(0)) await pc.addIceCandidate(candidate);
        if (signal.description.type === 'offer') {
          await pc.setLocalDescription(await pc.createAnswer());
          this.sendDescription(from, pc);
        }
      } else if (pc.remoteDescription) {
        await pc.addIceCandidate(signal.candidate);
      } else {
        peer.pendingCandidates.push(signal.candidate);
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
    this.peers.delete(peerId);
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

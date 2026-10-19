// Som da janela ou da tela compartilhada no app de desktop do Windows: o app captura só o
// som do programa escolhido (como o Discord) e manda o PCM; aqui ele vira uma faixa de áudio.
// Ver "Som da janela" em desktop/src/main.js.

import type { AppAudioBridge } from './desktop';

const WORKLET_URL = `${import.meta.env.BASE_URL}app-audio.worklet.js`;
const SAMPLE_RATE = 48000;

export class AppAudioFeed {
  private readonly context = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: 'interactive' });
  private node: AudioWorkletNode | null = null;
  private readonly destination = this.context.createMediaStreamDestination();
  private readonly pending: ArrayBuffer[] = [];
  private readonly unsubscribe: () => void;
  private readonly ready: Promise<void>;
  private closed = false;
  /** Captura a que este feed pertence; só se sabe depois que o pedido de tela é atendido. */
  sessionId: number | null = null;

  /** Assina já: o som pode chegar antes de a página receber o vídeo, e nada se perde. */
  constructor(private readonly bridge: AppAudioBridge) {
    this.unsubscribe = bridge.subscribe(
      (id, chunk) => {
        if (this.sessionId !== null && id !== this.sessionId) return;
        this.push(chunk);
      },
      () => {},
    );
    this.ready = this.context.audioWorklet.addModule(WORKLET_URL).then(() => {
      if (this.closed) return;
      this.node = new AudioWorkletNode(this.context, 'app-audio', { numberOfInputs: 0, outputChannelCount: [2] });
      this.node.connect(this.destination);
      for (const chunk of this.pending.splice(0)) this.node.port.postMessage(chunk, [chunk]);
    });
    void this.context.resume();
  }

  private push(chunk: Uint8Array): void {
    const copy = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer;
    if (this.node) this.node.port.postMessage(copy, [copy]);
    else if (this.pending.length < 200) this.pending.push(copy);
  }

  /** A faixa de áudio com o som capturado. */
  async track(): Promise<MediaStreamTrack> {
    await this.ready;
    return this.destination.stream.getAudioTracks()[0];
  }

  /** Para a captura no app e libera o áudio. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribe();
    if (this.sessionId !== null) this.bridge.stop(this.sessionId);
    this.destination.stream.getTracks().forEach((track) => track.stop());
    this.node?.disconnect();
    void this.context.close();
  }
}

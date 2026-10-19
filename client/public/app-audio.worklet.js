// Toca o PCM que o app de desktop captura do programa compartilhado (16 bits, estéreo, 48 kHz,
// intercalado) numa faixa de áudio. Roda na thread de áudio, sem depender da página.
//
// Mensagens recebidas: ArrayBuffer com amostras Int16 intercaladas (L, R, L, R...).
// Uma fila curta absorve o ritmo irregular da ponte entre processos; se ela enche, descarta
// o mais antigo (o som atrasa menos que travar), e se esvazia, toca silêncio.

const CAPACITY_SECONDS = 1;
const MAX_LATENCY_SECONDS = 0.25;
const START_SECONDS = 0.04;

class AppAudio extends AudioWorkletProcessor {
  constructor() {
    super();
    this.capacity = Math.ceil(sampleRate * CAPACITY_SECONDS);
    this.left = new Float32Array(this.capacity);
    this.right = new Float32Array(this.capacity);
    this.read = 0;
    this.size = 0;
    this.playing = false;
    this.port.onmessage = (event) => {
      const pcm = new Int16Array(event.data);
      const frames = pcm.length >> 1;
      for (let i = 0; i < frames; i++) {
        if (this.size === this.capacity) {
          this.read = (this.read + 1) % this.capacity;
          this.size--;
        }
        const at = (this.read + this.size) % this.capacity;
        this.left[at] = pcm[2 * i] / 32768;
        this.right[at] = pcm[2 * i + 1] / 32768;
        this.size++;
      }
      const maxFrames = Math.ceil(sampleRate * MAX_LATENCY_SECONDS);
      if (this.size > maxFrames) {
        const drop = this.size - maxFrames;
        this.read = (this.read + drop) % this.capacity;
        this.size = maxFrames;
      }
    };
  }

  process(_inputs, outputs) {
    const [left, right] = outputs[0];
    if (!left) return true;
    if (!this.playing && this.size >= sampleRate * START_SECONDS) this.playing = true;
    if (!this.playing) return true;
    for (let i = 0; i < left.length; i++) {
      if (this.size === 0) {
        this.playing = false; // acabou a fila: espera encher de novo para não picotar
        break;
      }
      left[i] = this.left[this.read];
      if (right) right[i] = this.right[this.read];
      this.read = (this.read + 1) % this.capacity;
      this.size--;
    }
    return true;
  }
}

registerProcessor('app-audio', AppAudio);

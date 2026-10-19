// Porta de ruído do microfone (a "sensibilidade de entrada" do Discord).
// Roda na thread de áudio: ao contrário de um temporizador da página, não perde
// o ritmo quando a janela fica em segundo plano (jogando, por exemplo).
//
// Mensagens recebidas: { enabled: boolean, threshold: number }  (limite em RMS linear, 0 a 1)
// Mensagens enviadas:  { level: number, open: boolean }          (RMS do período, 0 a 1; porta aberta?)

const HOLD_SECONDS = 0.25; // fica aberta um pouco depois da última palavra, para não cortar o fim da frase
const ATTACK_SECONDS = 0.004;
const RELEASE_SECONDS = 0.04;
const REPORT_SECONDS = 0.05;

class MicGate extends AudioWorkletProcessor {
  constructor() {
    super();
    this.enabled = false;
    this.threshold = 0;
    this.open = true;
    this.holdLeft = 0;
    this.gain = 1;
    this.peak = 0;
    this.sinceReport = 0;
    this.attack = 1 - Math.exp(-1 / (ATTACK_SECONDS * sampleRate));
    this.release = 1 - Math.exp(-1 / (RELEASE_SECONDS * sampleRate));
    this.port.onmessage = (event) => {
      const { enabled, threshold } = event.data;
      this.enabled = Boolean(enabled);
      this.threshold = Number(threshold) || 0;
      if (!this.enabled) this.open = true;
    };
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!input || !output) return true;

    let sum = 0;
    for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
    const rms = Math.sqrt(sum / input.length);
    this.peak = Math.max(this.peak, rms);

    if (this.enabled) {
      if (rms >= this.threshold) {
        this.open = true;
        this.holdLeft = HOLD_SECONDS * sampleRate;
      } else if (this.holdLeft > 0) {
        this.holdLeft -= input.length;
      } else {
        this.open = false;
      }
    }

    const target = this.open ? 1 : 0;
    const k = target > this.gain ? this.attack : this.release;
    for (let i = 0; i < input.length; i++) {
      this.gain += (target - this.gain) * k;
      output[i] = input[i] * this.gain;
    }

    this.sinceReport += input.length;
    if (this.sinceReport >= REPORT_SECONDS * sampleRate) {
      this.port.postMessage({ level: this.peak, open: this.open });
      this.peak = 0;
      this.sinceReport = 0;
    }
    return true;
  }
}

registerProcessor('mic-gate', MicGate);

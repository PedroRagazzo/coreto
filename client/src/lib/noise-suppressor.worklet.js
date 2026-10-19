// @ts-nocheck: roda no escopo do AudioWorklet (AudioWorkletProcessor, sampleRate...), que o TypeScript do DOM não conhece.
//
// Cancelamento de ruído com IA (RNNoise, o mesmo modelo que o Jitsi usa): tira teclado, ventilador,
// cliques e barulho de fundo da voz. O RNNoise trabalha em quadros de 480 amostras (10 ms) a 48 kHz,
// e o worklet recebe blocos de 128; duas filas circulares fazem a ponte, e o atraso total fica
// em ~10 ms. Carregado como módulo único pelo Vite (`?worker&url`), com o WebAssembly dentro.

import './noise-suppressor.shim.js';
import createRNNWasmModuleSync from '@jitsi/rnnoise-wasm/dist/rnnoise-sync.js';

const FRAME = 480;
const BLOCK = 128;
/** mmc(480, 128) = 1920: a fila dá a volta exatamente quando os dois tamanhos se alinham. */
const RING = 1920;
/** O modelo foi treinado com amostras de 16 bits; o Web Audio usa -1 a 1. */
const SCALE = 32768;

class NoiseSuppressor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.wasm = createRNNWasmModuleSync();
    this.inPtr = this.wasm._malloc(FRAME * 4);
    this.outPtr = this.wasm._malloc(FRAME * 4);
    this.state = this.wasm._rnnoise_create();
    this.inRing = new Float32Array(RING);
    this.outRing = new Float32Array(RING);
    this.inWrite = 0;
    this.inRead = 0;
    this.inCount = 0;
    this.outWrite = 0;
    this.outRead = 0;
    this.outCount = 0;
    this.alive = true;
    this.port.onmessage = (event) => {
      if (event.data === 'close') this.alive = false;
    };
  }

  process(inputs, outputs) {
    if (!this.alive) {
      this.wasm._rnnoise_destroy(this.state);
      this.wasm._free(this.inPtr);
      this.wasm._free(this.outPtr);
      return false;
    }
    const output = outputs[0][0];
    if (!output) return true;
    const input = inputs[0][0];
    if (!input) {
      output.fill(0);
      return true;
    }

    for (let i = 0; i < BLOCK; i++) this.inRing[(this.inWrite + i) % RING] = input[i];
    this.inWrite = (this.inWrite + BLOCK) % RING;
    this.inCount += BLOCK;

    while (this.inCount >= FRAME) {
      // A memória do WebAssembly pode crescer; relê a visão a cada quadro.
      const heap = this.wasm.HEAPF32;
      const inIndex = this.inPtr >> 2;
      const outIndex = this.outPtr >> 2;
      for (let i = 0; i < FRAME; i++) heap[inIndex + i] = this.inRing[(this.inRead + i) % RING] * SCALE;
      this.inRead = (this.inRead + FRAME) % RING;
      this.inCount -= FRAME;
      this.wasm._rnnoise_process_frame(this.state, this.outPtr, this.inPtr);
      for (let i = 0; i < FRAME; i++) this.outRing[(this.outWrite + i) % RING] = heap[outIndex + i] / SCALE;
      this.outWrite = (this.outWrite + FRAME) % RING;
      this.outCount += FRAME;
    }

    if (this.outCount >= BLOCK) {
      for (let i = 0; i < BLOCK; i++) output[i] = this.outRing[(this.outRead + i) % RING];
      this.outRead = (this.outRead + BLOCK) % RING;
      this.outCount -= BLOCK;
    } else {
      output.fill(0); // só nos primeiros 30 ms, até o primeiro quadro ficar pronto
    }
    return true;
  }
}

registerProcessor('noise-suppressor', NoiseSuppressor);

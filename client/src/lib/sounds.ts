// Sons da chamada, sintetizados na hora (nada de arquivos de áudio): alguém entra
// ou sai da chamada ou de uma transmissão, e você muta ou ensurdece.

import type { SoundKind } from '@shared/call-sounds';

export type { SoundKind };

interface Note {
  /** Frequência em Hz. */
  hz: number;
  /** Quando começa, em segundos. */
  at: number;
  /** Duração em segundos. */
  length: number;
}

interface Tone {
  type: OscillatorType;
  notes: Note[];
  /** Ganho de pico (0 a 1) antes do volume escolhido. */
  peak: number;
}

const pair = (a: number, b: number, length: number): Note[] => [
  { hz: a, at: 0, length },
  { hz: b, at: length * 0.9, length: length * 1.3 },
];

const TONES: Record<SoundKind, Tone> = {
  // Entrar e sair da chamada: duas notas, subindo e descendo.
  join: { type: 'sine', notes: pair(523, 784, 0.1), peak: 0.9 },
  leave: { type: 'sine', notes: pair(784, 523, 0.1), peak: 0.9 },
  // Alguém começa ou para de assistir à transmissão: mais agudo e mais curto.
  streamJoin: { type: 'sine', notes: pair(659, 988, 0.07), peak: 0.7 },
  streamLeave: { type: 'sine', notes: pair(988, 659, 0.07), peak: 0.7 },
  // Mutar e ensurdecer: toques secos, graves para o som e médios para o microfone.
  mute: { type: 'triangle', notes: pair(392, 294, 0.06), peak: 0.8 },
  unmute: { type: 'triangle', notes: pair(294, 392, 0.06), peak: 0.8 },
  deafen: { type: 'triangle', notes: pair(330, 220, 0.07), peak: 0.8 },
  undeafen: { type: 'triangle', notes: pair(220, 330, 0.07), peak: 0.8 },
};

type SinkContext = AudioContext & { setSinkId?: (id: string) => Promise<void> };

let context: SinkContext | null = null;
let sinkId: string | null = null;

export interface SoundOutput {
  /** 0 a 1. */
  volume: number;
  /** `null` = o padrão do sistema (onde o navegador deixa escolher a saída). */
  outputDeviceId: string | null;
}

export function playSound(kind: SoundKind, { volume, outputDeviceId }: SoundOutput): void {
  if (volume <= 0) return;
  try {
    context ??= new AudioContext();
    if (context.state === 'suspended') void context.resume();
    if (sinkId !== outputDeviceId && context.setSinkId) {
      sinkId = outputDeviceId;
      void context.setSinkId(outputDeviceId ?? '').catch(() => {});
    }
    const ctx = context;
    const tone = TONES[kind];
    const start = ctx.currentTime + 0.01;
    const master = ctx.createGain();
    // Volume escolhido ao quadrado: o ouvido sente o controle mais natural do que linear.
    master.gain.value = tone.peak * volume * volume * 0.35;
    master.connect(ctx.destination);
    for (const note of tone.notes) {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = tone.type;
      osc.frequency.value = note.hz;
      const from = start + note.at;
      // Entrada e saída suaves, para não estalar.
      env.gain.setValueAtTime(0, from);
      env.gain.linearRampToValueAtTime(1, from + 0.008);
      env.gain.exponentialRampToValueAtTime(0.001, from + note.length);
      osc.connect(env).connect(master);
      osc.start(from);
      osc.stop(from + note.length + 0.02);
    }
  } catch {
    // sem áudio disponível: sem som, sem problema
  }
}

import { dbToLinear, initialLeveler, levelerStep, LIMIT_HEADROOM, rmsDb, softLimitCurve, streamLevelerParams } from '@shared/voice-level';
import { useEffect, useRef } from 'react';

/** O quanto o volume de uma transmissão pode passar de 100% (300%). */
export const MAX_STREAM_VOLUME = 3;
const POLL_MS = 100;

interface Graph {
  context: AudioContext;
  /** O volume (até 100%). */
  gain: GainNode;
  /** O nivelador automático, usado só com o volume acima de 100%. */
  leveler: GainNode;
  meter: AnalyserNode;
  samples: Float32Array<ArrayBuffer>;
  /** Troca a fonte quando o fluxo ganha ou perde a faixa de áudio. */
  connect: (stream: MediaStream | null) => void;
  close: () => void;
}

/** Fonte → nivelador → volume → limitador suave → saída: o som sobe sem estourar. */
function buildGraph(): Graph {
  const context = new AudioContext({ latencyHint: 'interactive' });
  const leveler = context.createGain();
  const gain = context.createGain();
  const before = context.createGain();
  before.gain.value = 1 / LIMIT_HEADROOM;
  const shaper = context.createWaveShaper();
  shaper.curve = softLimitCurve();
  shaper.oversample = 'none';
  const after = context.createGain();
  after.gain.value = LIMIT_HEADROOM;
  leveler.connect(gain).connect(before).connect(shaper).connect(after).connect(context.destination);
  // O nível é medido na fonte, antes do ganho, para o ganho não realimentar a medida.
  const meter = context.createAnalyser();
  meter.fftSize = 2048;
  const samples = new Float32Array(meter.fftSize);
  let source: MediaStreamAudioSourceNode | null = null;
  return {
    context,
    gain,
    leveler,
    meter,
    samples,
    connect(stream) {
      source?.disconnect();
      source = null;
      if (!stream || stream.getAudioTracks().length === 0) return;
      source = context.createMediaStreamSource(stream);
      source.connect(leveler);
      source.connect(meter);
    },
    close() {
      source?.disconnect();
      void context.close();
    },
  };
}

/**
 * Toca o som de uma transmissão com volume de 0 a 300%: o elemento de vídeo continua mostrando a imagem (mudo), e o som
 * vai pelo Web Audio. Até 100% é só o volume. Acima disso o som também é nivelado automaticamente (o que chega baixo sobe
 * para um nível confortável, e quanto mais alto o volume, mais alto esse nível), com um limitador no fim para não estourar.
 * `enabled` falso (a sua própria tela, por exemplo) não toca nada.
 */
export function useBoostedAudio(stream: MediaStream | null, enabled: boolean, volume: number, silent: boolean, hasAudio: boolean): void {
  const graph = useRef<Graph | null>(null);
  const wanted = useRef({ volume, silent });
  wanted.current = { volume, silent };

  useEffect(() => {
    if (!enabled || !stream) return;
    const g = buildGraph();
    graph.current = g;
    void g.context.resume().catch(() => {});
    let state = initialLeveler();
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 0.25);
      last = now;
      const { volume: v, silent: s } = wanted.current;
      if (s || v <= 1) {
        // Sem nivelamento: o ganho volta a 1 e o nivelador recomeça do zero na próxima vez.
        state = initialLeveler();
        g.leveler.gain.setTargetAtTime(1, g.context.currentTime, 0.1);
        return;
      }
      g.meter.getFloatTimeDomainData(g.samples);
      state = levelerStep(state, rmsDb(g.samples), dt, streamLevelerParams(v));
      g.leveler.gain.setTargetAtTime(dbToLinear(state.gainDb), g.context.currentTime, 0.08);
    }, POLL_MS);
    return () => {
      clearInterval(timer);
      graph.current = null;
      g.close();
    };
  }, [enabled, stream]);

  // O som da tela pode chegar depois do vídeo: religa a fonte quando as faixas mudam.
  useEffect(() => {
    const g = graph.current;
    if (g && stream && enabled) g.connect(stream);
  }, [stream, enabled, hasAudio]);

  useEffect(() => {
    const g = graph.current;
    if (!g) return;
    g.gain.gain.setTargetAtTime(silent ? 0 : Math.min(1, Math.max(0, volume)), g.context.currentTime, 0.03);
    if (!silent) void g.context.resume().catch(() => {});
  }, [volume, silent, enabled, stream]);
}

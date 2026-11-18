import { LIMIT_HEADROOM, softLimitCurve } from '@shared/voice-level';
import { useEffect, useRef } from 'react';

/** O quanto o volume de uma transmissão pode passar de 100% (300%). */
export const MAX_STREAM_VOLUME = 3;

interface Graph {
  context: AudioContext;
  gain: GainNode;
  /** Troca a fonte quando o fluxo ganha ou perde a faixa de áudio. */
  connect: (stream: MediaStream | null) => void;
  close: () => void;
}

/** Fonte → ganho → limitador suave → saída: o som passa de 100% sem estourar. */
function buildGraph(): Graph {
  const context = new AudioContext({ latencyHint: 'interactive' });
  const gain = context.createGain();
  const before = context.createGain();
  before.gain.value = 1 / LIMIT_HEADROOM;
  const shaper = context.createWaveShaper();
  shaper.curve = softLimitCurve();
  shaper.oversample = 'none';
  const after = context.createGain();
  after.gain.value = LIMIT_HEADROOM;
  gain.connect(before).connect(shaper).connect(after).connect(context.destination);
  let source: MediaStreamAudioSourceNode | null = null;
  return {
    context,
    gain,
    connect(stream) {
      source?.disconnect();
      source = null;
      const tracks = stream?.getAudioTracks() ?? [];
      if (tracks.length === 0) return;
      source = context.createMediaStreamSource(new MediaStream(tracks));
      source.connect(gain);
    },
    close() {
      source?.disconnect();
      void context.close();
    },
  };
}

/**
 * Toca o som de uma transmissão com volume de 0 a 300%: o elemento de vídeo continua mostrando a imagem (mudo), e o som
 * vai pelo Web Audio, onde o ganho pode passar de 100%. `enabled` falso (a sua própria tela, por exemplo) não toca nada.
 */
export function useBoostedAudio(stream: MediaStream | null, enabled: boolean, volume: number, silent: boolean, hasAudio: boolean): void {
  const graph = useRef<Graph | null>(null);

  useEffect(() => {
    if (!enabled || !stream) return;
    const g = buildGraph();
    graph.current = g;
    void g.context.resume().catch(() => {});
    return () => {
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
    g.gain.gain.setTargetAtTime(silent ? 0 : Math.min(MAX_STREAM_VOLUME, Math.max(0, volume)), g.context.currentTime, 0.03);
    if (!silent) void g.context.resume().catch(() => {});
  }, [volume, silent, enabled, stream]);
}

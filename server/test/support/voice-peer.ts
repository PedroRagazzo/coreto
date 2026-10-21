import type { SignalPayload } from '../../../shared/src/protocol.js';
import type { Wrtc } from '../../src/music/bot-voice.js';

// Um "navegador" de mentira, com as mesmas regras de negociação do cliente, só para ver se o bot
// consegue ligar e ser ligado e se o áudio dele chega do outro lado.
export interface Human {
  receive(signal: SignalPayload): void;
  /** Liga para o bot, como quem entra numa sala onde ele já está. */
  callBot(): void;
  stats(): { frames: number; peak: number; sampleRate: number };
  close(): void;
}

export function makeHuman(wrtc: Wrtc, ids: { selfId: string; botId: string }, toBot: (signal: SignalPayload) => void): Human {
  const { RTCPeerConnection } = wrtc;
  const sinkApi = (wrtc as unknown as { nonstandard: { RTCAudioSink: new (track: unknown) => { ondata: (d: { samples: Int16Array; sampleRate: number }) => void; stop(): void } } }).nonstandard;
  const pc = new RTCPeerConnection({ iceServers: [], iceTransportPolicy: 'all' });
  const polite = ids.selfId < ids.botId;
  let makingOffer = false;
  let ignoreOffer = false;
  let frames = 0;
  let peak = 0;
  let sampleRate = 0;
  const sinks: { stop(): void }[] = [];

  const track = (pc as unknown as { ontrack: ((e: { track: unknown }) => void) | null });
  track.ontrack = ({ track: remote }) => {
    const sink = new sinkApi.RTCAudioSink(remote);
    sink.ondata = (d) => {
      frames++;
      sampleRate = d.sampleRate;
      for (const v of d.samples) peak = Math.max(peak, Math.abs(v));
    };
    sinks.push(sink);
  };
  pc.onicecandidate = ({ candidate }) => {
    if (candidate) toBot({ kind: 'candidate', candidate: { candidate: candidate.candidate, sdpMid: candidate.sdpMid, sdpMLineIndex: candidate.sdpMLineIndex } });
  };
  pc.onnegotiationneeded = () => {
    void (async () => {
      try {
        makingOffer = true;
        await pc.setLocalDescription(await pc.createOffer());
        const d = pc.localDescription!;
        toBot({ kind: 'description', description: { type: d.type as 'offer', sdp: d.sdp } });
      } finally {
        makingOffer = false;
      }
    })();
  };

  let chain: Promise<void> = Promise.resolve();
  return {
    receive(signal) {
      chain = chain.then(async () => {
        if (signal.kind === 'media') return;
        if (signal.kind === 'candidate') {
          try {
            await pc.addIceCandidate(signal.candidate);
          } catch (err) {
            if (!ignoreOffer) throw err;
          }
          return;
        }
        const collision = signal.description.type === 'offer' && (makingOffer || pc.signalingState !== 'stable');
        ignoreOffer = !polite && collision;
        if (ignoreOffer) return;
        if (collision) await pc.setLocalDescription({ type: 'rollback' });
        await pc.setRemoteDescription(signal.description);
        if (signal.description.type === 'offer') {
          await pc.setLocalDescription(await pc.createAnswer());
          const d = pc.localDescription!;
          toBot({ kind: 'description', description: { type: d.type as 'answer', sdp: d.sdp } });
        }
      });
    },
    callBot() {
      // Um microfone de mentira (silêncio) só para ter o que enviar e disparar a oferta.
      const mic = new wrtc.nonstandard.RTCAudioSource();
      pc.addTrack(mic.createTrack());
    },
    stats: () => ({ frames, peak, sampleRate }),
    close() {
      for (const s of sinks) s.stop();
      pc.close();
    },
  };
}

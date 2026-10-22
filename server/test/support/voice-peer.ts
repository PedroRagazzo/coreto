import type { SignalPayload } from '../../../shared/src/protocol.js';
import { withStereoOpus } from '../../../shared/src/opus-sdp.js';
import type { Wrtc } from '../../src/music/bot-voice.js';

// Um "navegador" de mentira, com as mesmas regras de negociação do cliente, só para ver se o bot
// consegue ligar e ser ligado e se o áudio dele chega do outro lado.
export interface Human {
  receive(signal: SignalPayload): void;
  /** Liga para o bot, como quem entra numa sala onde ele já está. */
  callBot(): void;
  /** `channels` é o que o decodificador entregou; os picos por canal só existem em estéreo (senão ficam em 0). */
  stats(): { frames: number; peak: number; sampleRate: number; channels: number; peakLeft: number; peakRight: number };
  close(): void;
}

/**
 * `stereo`: como o cliente, pede estéreo ao bot no SDP (com `false`, é um navegador antigo que decodifica em mono).
 */
export function makeHuman(
  wrtc: Wrtc,
  ids: { selfId: string; botId: string },
  toBot: (signal: SignalPayload) => void,
  { stereo = true }: { stereo?: boolean } = {},
): Human {
  const munged = (sdp: string | undefined) => (stereo && sdp ? withStereoOpus(sdp) : (sdp ?? ''));
  const { RTCPeerConnection } = wrtc;
  const sinkApi = (wrtc as unknown as { nonstandard: { RTCAudioSink: new (track: unknown) => { ondata: (d: { samples: Int16Array; sampleRate: number; channelCount: number }) => void; stop(): void } } }).nonstandard;
  const pc = new RTCPeerConnection({ iceServers: [], iceTransportPolicy: 'all' });
  const polite = ids.selfId < ids.botId;
  let makingOffer = false;
  let ignoreOffer = false;
  let frames = 0;
  let peak = 0;
  let sampleRate = 0;
  let channels = 0;
  let peakLeft = 0;
  let peakRight = 0;
  const sinks: { stop(): void }[] = [];

  const track = (pc as unknown as { ontrack: ((e: { track: unknown; streams: unknown[] }) => void) | null });
  track.ontrack = ({ track: remote, streams: [stream] }) => {
    // Como o cliente (client/src/lib/voice.ts): faixa sem fluxo associado é ignorada, e o navegador não toca o som.
    if (!stream) return;
    const sink = new sinkApi.RTCAudioSink(remote);
    sink.ondata = (d) => {
      frames++;
      sampleRate = d.sampleRate;
      channels = d.channelCount;
      for (const v of d.samples) peak = Math.max(peak, Math.abs(v));
      if (d.channelCount === 2) {
        for (let i = 0; i + 1 < d.samples.length; i += 2) {
          peakLeft = Math.max(peakLeft, Math.abs(d.samples[i]));
          peakRight = Math.max(peakRight, Math.abs(d.samples[i + 1]));
        }
      }
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
        const offer = await pc.createOffer();
        await pc.setLocalDescription({ type: 'offer', sdp: munged(offer.sdp) });
        const d = pc.localDescription!;
        toBot({ kind: 'description', description: { type: d.type as 'offer', sdp: d.sdp } });
      } catch (err) {
        // O teste pode fechar a conexão no meio da negociação (a limpeza roda assim que ele acaba); isso não é falha.
        if (pc.signalingState !== 'closed') console.warn('[teste] a negociação do navegador de mentira falhou', err);
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
          const answer = await pc.createAnswer();
          await pc.setLocalDescription({ type: 'answer', sdp: munged(answer.sdp) });
          const d = pc.localDescription!;
          toBot({ kind: 'description', description: { type: d.type as 'answer', sdp: d.sdp } });
        }
      }).catch((err: unknown) => {
        // Mesmo caso: depois que o teste fecha a conexão, a fila de sinais pendentes pode falhar sem importar.
        if (pc.signalingState !== 'closed') console.warn('[teste] sinal recusado pelo navegador de mentira', err);
      });
    },
    callBot() {
      // Um microfone de mentira (silêncio) só para ter o que enviar e disparar a oferta.
      const mic = new wrtc.nonstandard.RTCAudioSource();
      const micTrack = mic.createTrack();
      pc.addTrack(micTrack, new wrtc.MediaStream([micTrack]));
    },
    stats: () => ({ frames, peak, sampleRate, channels, peakLeft, peakRight }),
    close() {
      for (const s of sinks) s.stop();
      pc.close();
    },
  };
}

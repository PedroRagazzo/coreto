// As medições do diagnóstico (Configurações, Diagnóstico). Aqui só se mede, no navegador; o que os números querem dizer, e o
// texto para copiar, estão em shared/src/diagnostics.ts (testado sem navegador).

import {
  type AppProbe,
  type CallProbe,
  type DiagnosticCheck,
  type DiagnosticReport,
  judgeApp,
  judgeCall,
  judgeMic,
  judgeNetwork,
  judgeServer,
  judgeVideo,
  type MicProbe,
  type NetworkProbe,
  type VideoProbe,
} from '@shared/diagnostics';
import type { IceServer } from '@shared/protocol';
import type { RealtimeActions } from '../state/realtime/types';
import { desktop } from './desktop';
import { probeHardwareH264 } from './encoder';
import type { VoicePrefs } from './settings';
import { SERVER_URL } from './socket';
import { describeMediaError, openMicrophone } from './voice';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Quanto tempo o microfone fica sendo medido (a pessoa fala nesse intervalo). */
export const MIC_TEST_MS = 3000;
const NETWORK_TIMEOUT_MS = 8000;
const HTTP_PINGS = 4;

export function probeApp(): AppProbe {
  const nav = navigator as Navigator & { deviceMemory?: number; userAgentData?: { platform?: string } };
  return {
    desktopVersion: desktop?.version ?? null,
    userAgent: nav.userAgent,
    platform: nav.userAgentData?.platform ?? desktop?.platform ?? nav.platform,
    language: nav.language,
    online: nav.onLine,
    cores: nav.hardwareConcurrency || null,
    memoryGb: nav.deviceMemory ?? null,
    screen: `${screen.width}x${screen.height} (zoom ${Math.round(window.devicePixelRatio * 100)}%)`,
  };
}

/** Ida e volta de pedidos HTTP simples a /health, que passam pelo mesmo proxy do site. */
export async function probeHttp(): Promise<{ httpMs: number[]; httpFailed: number }> {
  const httpMs: number[] = [];
  let httpFailed = 0;
  for (let i = 0; i < HTTP_PINGS; i++) {
    const started = performance.now();
    try {
      // `no-cors`: no desenvolvimento o site e o servidor ficam em portas diferentes, e só o tempo importa.
      const res = await fetch(`${SERVER_URL}/health`, { cache: 'no-store', mode: 'no-cors', signal: AbortSignal.timeout(5000) });
      if (res.type !== 'opaque' && !res.ok) throw new Error(`HTTP ${res.status}`);
      httpMs.push(performance.now() - started);
    } catch {
      httpFailed++;
    }
  }
  return { httpMs, httpFailed };
}

async function micPermission(): Promise<string | null> {
  try {
    return (await navigator.permissions.query({ name: 'microphone' as PermissionName })).state;
  } catch {
    return null;
  }
}

async function countMicrophones(): Promise<number> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications').length;
  } catch {
    return 0;
  }
}

/** Abre o microfone com as suas configurações e mede, por `MIC_TEST_MS`, o trecho mais alto (a voz) e se estourou. */
export async function probeMic(prefs: VoicePrefs, onLevel?: (db: number) => void): Promise<MicProbe> {
  const probe: MicProbe = {
    supported: Boolean(navigator.mediaDevices?.getUserMedia) && window.isSecureContext,
    permission: await micPermission(),
    deviceCount: 0,
    opened: false,
    error: null,
    deviceLabel: null,
    levelDb: null,
    clipped: false,
    sampleRate: null,
    echoCancellation: null,
    noiseSuppression: null,
    autoGainControl: null,
  };
  if (!probe.supported) return probe;

  let stream: MediaStream;
  try {
    stream = await openMicrophone(prefs);
  } catch (err) {
    probe.error = describeMediaError(err);
    probe.deviceCount = await countMicrophones();
    probe.permission = (await micPermission()) ?? probe.permission;
    return probe;
  }

  let context: AudioContext | null = null;
  try {
    probe.opened = true;
    // Se o microfone abriu, a permissão existe (a consulta pode discordar em navegadores que liberam sem perguntar).
    probe.permission = 'granted';
    probe.deviceCount = await countMicrophones();
    const track = stream.getAudioTracks()[0];
    probe.deviceLabel = track?.label || null;
    const settings = track?.getSettings() ?? {};
    probe.sampleRate = settings.sampleRate ?? null;
    probe.echoCancellation = settings.echoCancellation ?? null;
    probe.noiseSuppression = settings.noiseSuppression ?? null;
    probe.autoGainControl = settings.autoGainControl ?? null;

    context = new AudioContext();
    await context.resume();
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    let loudest = 0;
    for (const end = performance.now() + MIC_TEST_MS; performance.now() < end; ) {
      await sleep(50);
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) {
        sum += sample * sample;
        if (Math.abs(sample) >= 0.99) probe.clipped = true;
      }
      const rms = Math.sqrt(sum / samples.length);
      loudest = Math.max(loudest, rms);
      onLevel?.(rms > 0 ? 20 * Math.log10(rms) : -100);
    }
    probe.levelDb = loudest > 0 ? 20 * Math.log10(loudest) : -100;
  } finally {
    stream.getTracks().forEach((t) => t.stop());
    void context?.close();
  }
  return probe;
}

/**
 * Procura caminhos para uma chamada (como o navegador faz ao entrar numa): quais endereços locais, quais públicos (STUN) e se
 * o servidor de retransmissão (TURN) abre um canal. Os endereços em si nunca saem daqui: só as contagens.
 */
export async function probeNetwork(iceServers: IceServer[]): Promise<NetworkProbe> {
  const probe: NetworkProbe = {
    supported: typeof RTCPeerConnection !== 'undefined',
    error: null,
    turnConfigured: iceServers.some((server) => [server.urls].flat().some((url) => /^turns?:/i.test(url))),
    host: 0,
    srflx: 0,
    relay: 0,
    relayProtocols: [],
    srflxMs: null,
    relayMs: null,
    timedOut: false,
  };
  if (!probe.supported) return probe;

  let pc: RTCPeerConnection;
  try {
    pc = new RTCPeerConnection({ iceServers, iceTransportPolicy: 'all' });
  } catch {
    probe.error = 'O navegador recusou os servidores de rede das chamadas.';
    return probe;
  }
  try {
    pc.createDataChannel('diagnostico');
    const started = performance.now();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        probe.timedOut = true;
        resolve();
      }, NETWORK_TIMEOUT_MS);
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      pc.onicecandidate = ({ candidate }) => {
        if (!candidate) return done();
        const elapsed = performance.now() - started;
        if (candidate.type === 'host') probe.host++;
        else if (candidate.type === 'srflx') {
          probe.srflx++;
          probe.srflxMs ??= elapsed;
        } else if (candidate.type === 'relay') {
          probe.relay++;
          probe.relayMs ??= elapsed;
          const protocol = (candidate as RTCIceCandidate & { relayProtocol?: string }).relayProtocol;
          if (protocol && !probe.relayProtocols.includes(protocol)) probe.relayProtocols.push(protocol);
        }
      };
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .catch(() => {
          probe.error = 'O navegador não conseguiu procurar caminhos para chamadas.';
          done();
        });
    });
  } finally {
    pc.close();
  }
  return probe;
}

/** Que formatos de vídeo o navegador manda, e se a placa de vídeo codifica H.264. */
export async function probeVideo(): Promise<VideoProbe> {
  let codecs: string[] = [];
  try {
    const names = (RTCRtpSender.getCapabilities?.('video')?.codecs ?? []).map((c) => c.mimeType.replace(/^video\//i, '').toUpperCase());
    codecs = [...new Set(names)].filter((name) => !['RTX', 'RED', 'ULPFEC', 'FLEXFEC-03'].includes(name));
  } catch {
    // Sem a API: a lista fica vazia e o veredito diz isso.
  }
  // O que o Coreto pede numa transmissão de jogo: 1080p a 60 quadros, nos perfis que a placa de vídeo codifica.
  const h264Hardware = await probeHardwareH264(1920, 1080, 60);
  return { codecs, h264Hardware };
}

export type DiagnosticStep =
  | { id: DiagnosticCheck['id']; state: 'running' }
  | { id: DiagnosticCheck['id']; state: 'done'; check: DiagnosticCheck };

export interface DiagnosticsInput {
  prefs: VoicePrefs;
  probeServer: RealtimeActions['probeServer'];
  probeIceServers: RealtimeActions['probeIceServers'];
  /** O último erro de conexão que o site registrou. */
  connectionError: string | null;
  /** A chamada de agora (a qualidade de cada pessoa). */
  call: CallProbe;
  /** Avisa cada teste que começa e cada um que termina, na ordem em que acontecem. */
  onStep(step: DiagnosticStep): void;
  /** O nível do microfone durante o teste dele, em dB. */
  onMicLevel?(db: number): void;
}

/** Roda todos os testes e devolve o relatório. Nenhum teste derruba os outros: o que falhar vira um veredito. */
export async function runDiagnostics(input: DiagnosticsInput): Promise<DiagnosticReport> {
  const checks: DiagnosticCheck[] = [];
  const step = async (id: DiagnosticCheck['id'], run: () => Promise<DiagnosticCheck> | DiagnosticCheck) => {
    input.onStep({ id, state: 'running' });
    const check = await run();
    checks.push(check);
    input.onStep({ id, state: 'done', check });
  };

  await step('app', () => judgeApp(probeApp()));
  await step('server', async () => {
    const [socket, http] = await Promise.all([input.probeServer(), probeHttp()]);
    return judgeServer({
      online: navigator.onLine,
      connected: socket.connected,
      transport: socket.transport,
      socketMs: socket.pingsMs,
      socketLost: socket.lost,
      httpMs: http.httpMs,
      httpFailed: http.httpFailed,
      connectionError: input.connectionError,
    });
  });
  // O microfone e a rede não dependem um do outro: andam juntos, para o teste todo durar pouco.
  await Promise.all([
    step('mic', async () => judgeMic(await probeMic(input.prefs, input.onMicLevel))),
    step('network', async () => {
      const ice = await input.probeIceServers();
      if (!ice.ok) {
        return judgeNetwork({ supported: true, error: ice.error, turnConfigured: false, host: 0, srflx: 0, relay: 0, relayProtocols: [], srflxMs: null, relayMs: null, timedOut: false });
      }
      return judgeNetwork(await probeNetwork(ice.data.iceServers));
    }),
  ]);
  await step('video', async () => judgeVideo(await probeVideo()));
  await step('call', () => judgeCall(input.call));

  // Na ordem em que a tela mostra, e não na que os testes terminaram.
  const order: DiagnosticCheck['id'][] = ['app', 'server', 'mic', 'network', 'video', 'call'];
  checks.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  return { generatedAt: new Date().toISOString(), checks };
}

// Diagnóstico da conexão: as medições (feitas pelo site, em client/src/lib/diagnostics.ts) viram um veredito em
// português simples, com o que fazer, e um texto que a pessoa copia e manda para quem está ajudando.
//
// Aqui só há lógica pura (números entram, texto sai), então ela é testada sem navegador. O texto copiado nunca leva
// senha, endereço IP, nome de ninguém nem mensagem.

import { describeConnectionError } from './connection-error.js';
import { type ConnectionQuality, describeQuality, ownLevel, type QualityLevel } from './connection-quality.js';

export type Verdict = 'ok' | 'warn' | 'fail' | 'info';

export interface DiagnosticCheck {
  id: 'app' | 'server' | 'mic' | 'network' | 'video' | 'call';
  title: string;
  verdict: Verdict;
  /** Uma linha, em palavras simples. */
  summary: string;
  /** O que fazer, quando há o que fazer. */
  advice?: string;
  /** Os números por trás do veredito, para quem for ajudar. */
  details: Array<[label: string, value: string]>;
}

export interface DiagnosticReport {
  /** ISO. */
  generatedAt: string;
  checks: DiagnosticCheck[];
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};
const round = (value: number) => Math.round(value);
const ms = (value: number) => `${round(value)} ms`;
const db = (value: number) => `${round(value)} dB`;

// ── Este computador ──────────────────────────────────────────────────────────

export interface AppProbe {
  /** Versão do app de desktop, ou `null` no navegador. */
  desktopVersion: string | null;
  userAgent: string;
  platform: string;
  language: string;
  online: boolean;
  cores: number | null;
  /** GB de memória que o navegador informa (arredondado por ele). */
  memoryGb: number | null;
  screen: string;
}

export function judgeApp(probe: AppProbe): DiagnosticCheck {
  return {
    id: 'app',
    title: 'Este computador',
    verdict: 'info',
    summary: probe.desktopVersion ? `App de desktop ${probe.desktopVersion}` : 'Navegador',
    details: [
      ['App de desktop', probe.desktopVersion ?? 'não (navegador)'],
      ['Navegador', probe.userAgent],
      ['Sistema', probe.platform || 'desconhecido'],
      ['Idioma', probe.language],
      ['Núcleos do processador', probe.cores === null ? 'desconhecido' : String(probe.cores)],
      ['Memória', probe.memoryGb === null ? 'desconhecida' : `${probe.memoryGb} GB ou mais`],
      ['Tela', probe.screen],
    ],
  };
}

// ── Servidor ─────────────────────────────────────────────────────────────────

export interface ServerProbe {
  online: boolean;
  /** O socket está conectado agora. */
  connected: boolean;
  /** Como o socket fala com o servidor (`websocket` ou `polling`). */
  transport: string | null;
  /** Ida e volta de cada pedido pelo socket (ms); os que não voltaram a tempo não entram. */
  socketMs: number[];
  socketLost: number;
  /** O mesmo, por HTTP simples (inclui o proxy do servidor). */
  httpMs: number[];
  httpFailed: number;
  /** O último erro de conexão que o site registrou, se houver. */
  connectionError: string | null;
}

export function judgeServer(probe: ServerProbe): DiagnosticCheck {
  const sent = probe.socketMs.length + probe.socketLost;
  const details: DiagnosticCheck['details'] = [
    ['Conexão em tempo real', probe.connected ? `ligada (${probe.transport ?? 'transporte desconhecido'})` : 'desligada'],
    ['Pedidos pelo socket', sent === 0 ? 'nenhum' : `${probe.socketMs.length} de ${sent} respondidos`],
  ];
  if (probe.socketMs.length) {
    details.push(['Ida e volta pelo socket', `mediana ${ms(median(probe.socketMs))}, de ${ms(Math.min(...probe.socketMs))} a ${ms(Math.max(...probe.socketMs))}`]);
  }
  const httpSent = probe.httpMs.length + probe.httpFailed;
  if (httpSent > 0) {
    details.push([
      'Ida e volta por HTTP',
      probe.httpMs.length
        ? `mediana ${ms(median(probe.httpMs))} (${probe.httpMs.length} de ${httpSent} responderam)`
        : `nenhum dos ${httpSent} pedidos respondeu`,
    ]);
  }
  if (probe.connectionError) details.push(['Último erro de conexão', probe.connectionError]);
  const check = (verdict: Verdict, summary: string, advice?: string): DiagnosticCheck => ({
    id: 'server',
    title: 'Servidor do Coreto',
    verdict,
    summary,
    ...(advice && { advice }),
    details,
  });

  if (!probe.online) return check('fail', 'Você está sem internet.', 'Confira o cabo, o Wi-Fi ou o plano de dados.');
  if (!probe.connected) {
    return check(
      'fail',
      'O Coreto não está conectado ao servidor.',
      describeConnectionError(probe.connectionError, probe.online) ??
        'Espere alguns segundos: o site tenta de novo sozinho. Se continuar, o servidor pode estar fora do ar.',
    );
  }
  if (probe.socketMs.length === 0) {
    return check('fail', 'O servidor não respondeu a nenhum pedido.', 'A conexão parece presa: recarregue o site (Ctrl+R) e rode o diagnóstico de novo.');
  }

  const typical = median(probe.socketMs);
  const spread = Math.max(...probe.socketMs) - Math.min(...probe.socketMs);
  const lossPercent = sent === 0 ? 0 : (probe.socketLost / sent) * 100;
  if (lossPercent >= 20) {
    return check('fail', `O servidor deixou de responder a ${round(lossPercent)}% dos pedidos.`, 'A conexão com o servidor está perdendo dados: aproxime-se do roteador ou troque de rede.');
  }
  if (probe.transport === 'polling') {
    return check(
      'warn',
      `Conectado, mas sem WebSocket (mais lento): resposta em ${ms(typical)}.`,
      'Algo no caminho (VPN, antivírus, proxy ou firewall) bloqueia o WebSocket. Desligue-os para testar.',
    );
  }
  if (spread >= 150 || lossPercent > 0) {
    return check('warn', `Conectado, mas a resposta oscila (${ms(Math.min(...probe.socketMs))} a ${ms(Math.max(...probe.socketMs))}).`, 'Uma internet instável causa travadas na chamada. Teste de novo sem outros downloads em andamento.');
  }
  if (typical > 400) {
    return check('warn', `Conectado, mas a resposta é lenta: ${ms(typical)}.`, 'Confira sua internet. Se só o Coreto está lento, o servidor pode estar sobrecarregado.');
  }
  if (typical > 150) {
    return check(
      'warn',
      `Conectado, resposta em ${ms(typical)}: o servidor está longe de você.`,
      'Isso aumenta o atraso das chamadas, mas não é defeito da sua internet nem dá para resolver aí.',
    );
  }
  return check('ok', `Conectado, resposta em ${ms(typical)}.`);
}

// ── Microfone ────────────────────────────────────────────────────────────────

export interface MicProbe {
  /** O navegador tem microfone para sites (precisa de https ou localhost). */
  supported: boolean;
  /** `granted`, `denied`, `prompt`, ou `null` se o navegador não diz. */
  permission: string | null;
  deviceCount: number;
  opened: boolean;
  /** O motivo, em português, de não ter aberto. */
  error: string | null;
  deviceLabel: string | null;
  /** O trecho mais alto medido (RMS de 50 ms), em dB abaixo do máximo; `null` se não mediu. */
  levelDb: number | null;
  /** Alguma amostra encostou no máximo (a voz está estourando). */
  clipped: boolean;
  sampleRate: number | null;
  echoCancellation: boolean | null;
  noiseSuppression: boolean | null;
  autoGainControl: boolean | null;
}

/** Abaixo disto o que se mediu é ruído de fundo, não voz. */
const MIC_SILENT_DB = -65;
/** Voz falada de perto costuma ficar entre −40 e −20 dB; abaixo disto o outro lado ouve baixinho. */
const MIC_QUIET_DB = -50;

export function judgeMic(probe: MicProbe): DiagnosticCheck {
  const sampleFlags = (value: boolean | null) => (value === null ? 'não informado' : value ? 'ligado' : 'desligado');
  const details: DiagnosticCheck['details'] = [
    ['Permissão', probe.permission ?? 'não informada'],
    ['Microfones encontrados', String(probe.deviceCount)],
    ['Microfone usado', probe.deviceLabel ?? 'padrão do sistema'],
  ];
  if (probe.opened) {
    details.push(
      ['Nível da voz no teste', probe.levelDb === null ? 'não medido' : db(probe.levelDb)],
      ['Taxa de amostragem', probe.sampleRate === null ? 'não informada' : `${probe.sampleRate} Hz`],
      ['Cancelamento de eco', sampleFlags(probe.echoCancellation)],
      ['Supressão de ruído', sampleFlags(probe.noiseSuppression)],
      ['Controle automático de ganho', sampleFlags(probe.autoGainControl)],
    );
  }
  const check = (verdict: Verdict, summary: string, advice?: string): DiagnosticCheck => ({
    id: 'mic',
    title: 'Microfone',
    verdict,
    summary,
    ...(advice && { advice }),
    details,
  });

  if (!probe.supported) {
    return check('fail', 'Este navegador não deixa o site usar o microfone.', 'O microfone só funciona em páginas seguras (https). Use o endereço oficial do Coreto ou o app de desktop.');
  }
  if (!probe.opened) {
    if (probe.permission === 'denied') {
      return check('fail', 'O navegador bloqueou o microfone para o Coreto.', 'Clique no cadeado ao lado do endereço, libere o microfone e rode o diagnóstico de novo.');
    }
    if (probe.deviceCount === 0 && probe.permission === 'granted') {
      return check('fail', 'Nenhum microfone foi encontrado.', 'Conecte um microfone ou fone e confira se o Windows o reconhece (Configurações, Sistema, Som).');
    }
    return check('fail', probe.error ?? 'Não deu para abrir o microfone.', 'Feche outros programas que usam o microfone (Discord, jogos, gravadores) e confira a permissão do navegador.');
  }
  if (probe.levelDb === null || probe.levelDb < MIC_SILENT_DB) {
    return check(
      'warn',
      'O microfone abriu, mas não captou som.',
      'Se você falou durante o teste, ele pode estar mudo no Windows, ser o dispositivo errado ou estar com o volume em zero. Escolha o certo em Voz e vídeo.',
    );
  }
  if (probe.clipped) {
    return check('warn', `Sua voz está estourando (${db(probe.levelDb)}).`, 'Baixe o volume do microfone, aqui em Voz e vídeo ou no Windows, ou afaste-se dele.');
  }
  if (probe.levelDb < MIC_QUIET_DB) {
    return check('warn', `Sua voz chegou baixa (${db(probe.levelDb)}).`, 'Suba o volume do microfone, aqui em Voz e vídeo ou no Windows, ou chegue mais perto dele.');
  }
  return check('ok', `Microfone funcionando (voz em ${db(probe.levelDb)}).`);
}

// ── Rede das chamadas (WebRTC) ───────────────────────────────────────────────

export interface NetworkProbe {
  /** O navegador sabe fazer chamadas (WebRTC). */
  supported: boolean;
  /** O servidor não entregou os servidores de rede. */
  error: string | null;
  /** O servidor oferece um servidor de retransmissão (TURN). */
  turnConfigured: boolean;
  host: number;
  /** Endereços públicos descobertos por STUN: se há algum, o UDP sai da sua rede. */
  srflx: number;
  /** Canais abertos no servidor de retransmissão. */
  relay: number;
  /** Como o canal do TURN foi aberto (`udp`, `tcp`, `tls`). */
  relayProtocols: string[];
  /** Quanto levou (ms) até o primeiro endereço público e até o primeiro canal de retransmissão. */
  srflxMs: number | null;
  relayMs: number | null;
  /** A busca de caminhos não terminou no prazo. */
  timedOut: boolean;
}

export function judgeNetwork(probe: NetworkProbe): DiagnosticCheck {
  const details: DiagnosticCheck['details'] = [
    ['Caminhos locais', String(probe.host)],
    ['Endereço público descoberto (STUN)', probe.srflx > 0 ? `sim${probe.srflxMs === null ? '' : `, em ${ms(probe.srflxMs)}`}` : 'não'],
    [
      'Servidor de retransmissão (TURN)',
      !probe.turnConfigured
        ? 'não configurado no servidor'
        : probe.relay > 0
          ? `respondeu${probe.relayMs === null ? '' : ` em ${ms(probe.relayMs)}`} (${probe.relayProtocols.join(', ') || 'protocolo desconhecido'})`
          : 'não respondeu',
    ],
  ];
  if (probe.timedOut) details.push(['Busca de caminhos', 'não terminou no prazo']);
  const check = (verdict: Verdict, summary: string, advice?: string): DiagnosticCheck => ({
    id: 'network',
    title: 'Rede das chamadas',
    verdict,
    summary,
    ...(advice && { advice }),
    details,
  });

  if (!probe.supported) return check('fail', 'Este navegador não faz chamadas de voz.', 'Use o app de desktop do Coreto ou um navegador atual (Chrome, Edge).');
  if (probe.error) return check('fail', probe.error, 'Recarregue o site e tente de novo.');
  if (probe.srflx === 0 && probe.relay === 0) {
    return check(
      'fail',
      'Não consegui falar com os servidores de rede das chamadas.',
      'O firewall, o antivírus ou a VPN provavelmente bloqueia o UDP, que a voz usa. Desligue-os para testar, ou libere o Coreto.',
    );
  }
  if (probe.srflx === 0) {
    return check(
      'warn',
      'Só o servidor de retransmissão responde: as chamadas funcionam, mas com mais atraso.',
      'O caminho direto está bloqueado (firewall, antivírus, VPN ou um roteador mais rígido). Desligar a VPN costuma resolver.',
    );
  }
  if (probe.turnConfigured && probe.relay === 0) {
    return check(
      'warn',
      'O caminho direto funciona, mas o servidor de retransmissão não respondeu.',
      'Com a maioria das pessoas isso basta. Mas se alguém estiver atrás de uma rede rígida, a chamada com essa pessoa não vai conectar: avise quem cuida do servidor.',
    );
  }
  return check('ok', probe.relay > 0 ? 'Rede pronta para chamadas, direta e pelo servidor de retransmissão.' : 'Rede pronta para chamadas diretas.');
}

// ── Transmissão de tela (vídeo) ──────────────────────────────────────────────

export interface VideoProbe {
  codecs: string[];
  /** O navegador acelera a codificação H.264 na placa de vídeo; `null` se não sabe dizer. */
  h264Hardware: boolean | null;
}

export function judgeVideo(probe: VideoProbe): DiagnosticCheck {
  const h264 = probe.codecs.includes('H264');
  const details: DiagnosticCheck['details'] = [
    ['Formatos de vídeo', probe.codecs.length ? probe.codecs.join(', ') : 'nenhum'],
    ['H.264 pela placa de vídeo', probe.h264Hardware === null ? 'não informado' : probe.h264Hardware ? 'sim' : 'não'],
  ];
  const check = (verdict: Verdict, summary: string, advice?: string): DiagnosticCheck => ({
    id: 'video',
    title: 'Transmissão de tela',
    verdict,
    summary,
    ...(advice && { advice }),
    details,
  });

  if (probe.codecs.length === 0) return check('fail', 'Este navegador não manda vídeo.', 'Use o app de desktop do Coreto ou um navegador atual.');
  if (!h264) return check('warn', 'Sem H.264: a transmissão usa o processador.', 'Atualize o navegador ou o driver da placa de vídeo.');
  if (probe.h264Hardware === false) {
    return check(
      'warn',
      'A placa de vídeo não está codificando H.264: a transmissão vai usar o processador.',
      'Atualize o driver da placa de vídeo. Em jogos pesados, a transmissão pode ficar com poucos quadros.',
    );
  }
  return check('ok', probe.h264Hardware ? 'A placa de vídeo codifica H.264: transmissão leve.' : 'H.264 disponível.');
}

// ── A chamada de agora ───────────────────────────────────────────────────────

export interface CallProbe {
  inCall: boolean;
  /** A qualidade medida de cada pessoa da chamada, sem os nomes. */
  peers: ConnectionQuality[];
}

const LEVEL_LABEL: Record<QualityLevel, string> = { good: 'boa', fair: 'oscilando', poor: 'ruim' };

export function judgeCall(probe: CallProbe): DiagnosticCheck {
  const details: DiagnosticCheck['details'] = probe.peers.map((peer, i) => [`Pessoa ${i + 1}`, describeQuality(peer)]);
  const check = (verdict: Verdict, summary: string, advice?: string): DiagnosticCheck => ({
    id: 'call',
    title: 'Chamada de agora',
    verdict,
    summary,
    ...(advice && { advice }),
    details,
  });

  if (!probe.inCall) {
    return check('info', 'Você não está em uma chamada.', 'Entre em um canal de voz com alguém, espere uns 10 segundos e rode o diagnóstico de novo para medir cada conexão.');
  }
  if (probe.peers.length === 0) return check('info', 'Você está sozinho na chamada: não há o que medir.');

  const poor = probe.peers.filter((p) => p.level === 'poor').length;
  const fair = probe.peers.filter((p) => p.level === 'fair').length;
  const own = ownLevel(probe.peers.map((p) => p.level));
  const relayed = probe.peers.filter((p) => p.relayed).length;
  if (relayed > 0) details.push(['Passando pelo servidor de retransmissão', `${relayed} de ${probe.peers.length}`]);
  if (own) details.push(['Sua conexão, no conjunto', LEVEL_LABEL[own]]);

  if (poor === 0 && fair === 0) {
    return check('ok', probe.peers.length === 1 ? 'A conexão da chamada está boa.' : `As ${probe.peers.length} conexões da chamada estão boas.`);
  }
  const bad = poor + fair;
  const where =
    probe.peers.length === 1
      ? 'o problema está entre você e essa pessoa'
      : bad * 2 > probe.peers.length
        ? 'a maioria está ruim, então o problema provavelmente é a sua conexão'
        : 'só algumas estão ruins, então o problema provavelmente é de quem está do outro lado';
  return check(poor > 0 ? 'fail' : 'warn', `${bad} de ${probe.peers.length} conexões com problema: ${where}.`, 'O "pipoca" vem de pacotes de áudio perdidos ou atrasados. Compare a perda e a oscilação de cada pessoa nos detalhes.');
}

// ── Texto para copiar ────────────────────────────────────────────────────────

const VERDICT_LABEL: Record<Verdict, string> = { ok: 'OK', warn: 'ATENÇÃO', fail: 'PROBLEMA', info: 'INFO' };

/** Quantos testes terminaram em cada veredito, e o texto de resumo que a tela mostra no topo. */
export function summarizeReport(report: DiagnosticReport): { fail: number; warn: number; text: string } {
  const fail = report.checks.filter((c) => c.verdict === 'fail').length;
  const warn = report.checks.filter((c) => c.verdict === 'warn').length;
  if (fail > 0) return { fail, warn, text: fail === 1 ? 'Um teste encontrou um problema.' : `${fail} testes encontraram problemas.` };
  if (warn > 0) return { fail, warn, text: warn === 1 ? 'Um ponto merece atenção.' : `${warn} pontos merecem atenção.` };
  return { fail, warn, text: 'Tudo certo.' };
}

/** O relatório em texto simples, pronto para colar numa conversa. Sem senha, IP, nomes nem mensagens. */
export function formatReport(report: DiagnosticReport): string {
  const when = new Date(report.generatedAt);
  const stamp = Number.isNaN(when.getTime()) ? report.generatedAt : when.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const lines = [`Diagnóstico do Coreto (${stamp})`, `Resumo: ${summarizeReport(report).text}`, ''];
  for (const check of report.checks) {
    lines.push(`[${VERDICT_LABEL[check.verdict]}] ${check.title}: ${check.summary}`);
    if (check.advice) lines.push(`  O que fazer: ${check.advice}`);
    for (const [label, value] of check.details) lines.push(`  - ${label}: ${value}`);
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

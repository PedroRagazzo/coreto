import { describe, expect, it } from 'vitest';
import type { ConnectionQuality } from '../../../shared/src/connection-quality.js';
import {
  formatReport,
  judgeApp,
  judgeCall,
  judgeMic,
  judgeNetwork,
  judgeServer,
  judgeVideo,
  summarizeReport,
  type MicProbe,
  type NetworkProbe,
  type ServerProbe,
} from '../../../shared/src/diagnostics.js';

const server = (patch: Partial<ServerProbe> = {}): ServerProbe => ({
  online: true,
  connected: true,
  transport: 'websocket',
  socketMs: [40, 42, 38, 45, 41],
  socketLost: 0,
  httpMs: [60, 58, 62, 61],
  httpFailed: 0,
  connectionError: null,
  ...patch,
});

describe('judgeServer', () => {
  it('conexão rápida e estável: tudo certo, sem conselho', () => {
    const check = judgeServer(server());
    expect(check.verdict).toBe('ok');
    expect(check.summary).toBe('Conectado, resposta em 41 ms.');
    expect(check.advice).toBeUndefined();
  });

  it('sem internet', () => {
    expect(judgeServer(server({ online: false, connected: false }))).toMatchObject({ verdict: 'fail', summary: 'Você está sem internet.' });
  });

  it('desconectado: usa a explicação amigável do último erro', () => {
    const check = judgeServer(server({ connected: false, socketMs: [], connectionError: 'xhr poll error' }));
    expect(check.verdict).toBe('fail');
    expect(check.advice).toContain('VPN, antivírus ou firewall');
    expect(check.details).toContainEqual(['Último erro de conexão', 'xhr poll error']);
  });

  it('conectado mas nenhum pedido voltou', () => {
    expect(judgeServer(server({ socketMs: [], socketLost: 5 }))).toMatchObject({ verdict: 'fail', summary: 'O servidor não respondeu a nenhum pedido.' });
  });

  it('servidor longe (a realidade de quem está longe dele): aviso que diz que não é culpa da sua internet', () => {
    const check = judgeServer(server({ socketMs: [220, 225, 230, 222, 228] }));
    expect(check.verdict).toBe('warn');
    expect(check.summary).toContain('longe de você');
    expect(check.advice).toContain('não é defeito da sua internet');
  });

  it('resposta muito lenta', () => {
    expect(judgeServer(server({ socketMs: [500, 520, 510] })).summary).toContain('lenta');
  });

  it('resposta que oscila muito', () => {
    const check = judgeServer(server({ socketMs: [40, 400, 45, 380, 42] }));
    expect(check).toMatchObject({ verdict: 'warn' });
    expect(check.summary).toContain('oscila');
  });

  it('sem WebSocket (caiu no polling) pede para olhar VPN, antivírus e proxy', () => {
    const check = judgeServer(server({ transport: 'polling' }));
    expect(check.verdict).toBe('warn');
    expect(check.advice).toContain('WebSocket');
  });

  it('muita perda pelo socket é problema; pouca é só aviso', () => {
    expect(judgeServer(server({ socketMs: [40, 41, 42], socketLost: 2 })).verdict).toBe('fail');
    expect(judgeServer(server({ socketMs: [40, 41, 42, 43, 44, 45, 46, 47, 48], socketLost: 1 })).verdict).toBe('warn');
  });

  it('mostra nos detalhes a mediana e os extremos', () => {
    const { details } = judgeServer(server());
    expect(details).toContainEqual(['Ida e volta pelo socket', 'mediana 41 ms, de 38 ms a 45 ms']);
  });
});

const mic = (patch: Partial<MicProbe> = {}): MicProbe => ({
  supported: true,
  permission: 'granted',
  deviceCount: 1,
  opened: true,
  error: null,
  deviceLabel: 'Microfone (fone gamer)',
  levelDb: -28,
  clipped: false,
  sampleRate: 48000,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  ...patch,
});

describe('judgeMic', () => {
  it('voz em nível normal: ok, com o nível no texto', () => {
    expect(judgeMic(mic())).toMatchObject({ verdict: 'ok', summary: 'Microfone funcionando (voz em -28 dB).' });
  });

  it('abriu mas só silêncio: aviso, falando em mudo e em dispositivo errado', () => {
    const check = judgeMic(mic({ levelDb: -90 }));
    expect(check.verdict).toBe('warn');
    expect(check.advice).toMatch(/mudo.*dispositivo errado/);
  });

  it('voz baixa e voz estourando pedem coisas opostas', () => {
    expect(judgeMic(mic({ levelDb: -55 })).advice).toContain('Suba o volume');
    expect(judgeMic(mic({ levelDb: -8, clipped: true })).advice).toContain('Baixe o volume');
  });

  it('permissão negada, sem microfone e microfone ocupado', () => {
    expect(judgeMic(mic({ opened: false, permission: 'denied', levelDb: null }))).toMatchObject({ verdict: 'fail', summary: 'O navegador bloqueou o microfone para o Coreto.' });
    expect(judgeMic(mic({ opened: false, deviceCount: 0, levelDb: null })).summary).toBe('Nenhum microfone foi encontrado.');
    expect(judgeMic(mic({ opened: false, permission: 'prompt', error: 'O microfone está em uso por outro programa.', levelDb: null })).summary).toBe(
      'O microfone está em uso por outro programa.',
    );
  });

  it('página sem https', () => {
    expect(judgeMic(mic({ supported: false, opened: false, levelDb: null })).advice).toContain('https');
  });

  it('não lista detalhes de áudio quando o microfone nem abriu', () => {
    const { details } = judgeMic(mic({ opened: false, levelDb: null, permission: 'denied' }));
    expect(details.map(([label]) => label)).toEqual(['Permissão', 'Microfones encontrados', 'Microfone usado']);
  });
});

const network = (patch: Partial<NetworkProbe> = {}): NetworkProbe => ({
  supported: true,
  error: null,
  turnConfigured: true,
  host: 2,
  srflx: 1,
  relay: 1,
  relayProtocols: ['udp'],
  srflxMs: 60,
  relayMs: 180,
  timedOut: false,
  ...patch,
});

describe('judgeNetwork', () => {
  it('direto e pelo TURN: pronto', () => {
    expect(judgeNetwork(network())).toMatchObject({ verdict: 'ok', summary: 'Rede pronta para chamadas, direta e pelo servidor de retransmissão.' });
  });

  it('sem TURN configurado e UDP saindo: pronto para chamadas diretas', () => {
    expect(judgeNetwork(network({ turnConfigured: false, relay: 0, relayProtocols: [], relayMs: null }))).toMatchObject({
      verdict: 'ok',
      summary: 'Rede pronta para chamadas diretas.',
    });
  });

  it('nada responde: o UDP está bloqueado', () => {
    const check = judgeNetwork(network({ srflx: 0, relay: 0, srflxMs: null, relayMs: null, relayProtocols: [] }));
    expect(check.verdict).toBe('fail');
    expect(check.advice).toContain('UDP');
  });

  it('só o TURN responde: funciona, com mais atraso', () => {
    expect(judgeNetwork(network({ srflx: 0, srflxMs: null }))).toMatchObject({ verdict: 'warn' });
  });

  it('o TURN existe mas não respondeu', () => {
    const check = judgeNetwork(network({ relay: 0, relayProtocols: [], relayMs: null }));
    expect(check.verdict).toBe('warn');
    expect(check.details).toContainEqual(['Servidor de retransmissão (TURN)', 'não respondeu']);
  });

  it('navegador sem chamadas, e erro ao obter os servidores', () => {
    expect(judgeNetwork(network({ supported: false })).verdict).toBe('fail');
    expect(judgeNetwork(network({ error: 'Sem conexão com o servidor.' })).summary).toBe('Sem conexão com o servidor.');
  });

  it('nunca escreve endereços IP: só contagens e tempos', () => {
    const text = JSON.stringify(judgeNetwork(network()));
    expect(text).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  });
});

describe('judgeVideo', () => {
  it('H.264 pela placa de vídeo: leve', () => {
    expect(judgeVideo({ codecs: ['VP8', 'VP9', 'H264'], h264Hardware: true })).toMatchObject({ verdict: 'ok', summary: 'A placa de vídeo codifica H.264: transmissão leve.' });
  });

  it('H.264 pelo processador: aviso para atualizar o driver', () => {
    const check = judgeVideo({ codecs: ['VP8', 'H264'], h264Hardware: false });
    expect(check.verdict).toBe('warn');
    expect(check.advice).toContain('driver');
  });

  it('o navegador não sabe dizer se é a placa: ainda assim H.264 existe', () => {
    expect(judgeVideo({ codecs: ['H264'], h264Hardware: null }).verdict).toBe('ok');
  });

  it('sem H.264 e sem nenhum vídeo', () => {
    expect(judgeVideo({ codecs: ['VP8', 'VP9'], h264Hardware: null }).verdict).toBe('warn');
    expect(judgeVideo({ codecs: [], h264Hardware: null }).verdict).toBe('fail');
  });
});

const quality = (patch: Partial<ConnectionQuality> = {}): ConnectionQuality => ({ level: 'good', rttMs: 40, lossPercent: 0, jitterMs: 5, ...patch });

describe('judgeCall', () => {
  it('fora de uma chamada, só informa o que fazer', () => {
    expect(judgeCall({ inCall: false, peers: [] })).toMatchObject({ verdict: 'info', summary: 'Você não está em uma chamada.' });
  });

  it('sozinho na chamada', () => {
    expect(judgeCall({ inCall: true, peers: [] }).verdict).toBe('info');
  });

  it('todas boas', () => {
    expect(judgeCall({ inCall: true, peers: [quality(), quality()] })).toMatchObject({ verdict: 'ok', summary: 'As 2 conexões da chamada estão boas.' });
    expect(judgeCall({ inCall: true, peers: [quality()] }).summary).toBe('A conexão da chamada está boa.');
  });

  it('a maioria ruim aponta para a sua conexão; só uma ruim, para a pessoa', () => {
    const mostly = judgeCall({ inCall: true, peers: [quality({ level: 'poor' }), quality({ level: 'poor' }), quality()] });
    expect(mostly).toMatchObject({ verdict: 'fail' });
    expect(mostly.summary).toContain('provavelmente é a sua conexão');

    const one = judgeCall({ inCall: true, peers: [quality({ level: 'fair', lossPercent: 3 }), quality(), quality(), quality()] });
    expect(one.verdict).toBe('warn');
    expect(one.summary).toContain('de quem está do outro lado');
  });

  it('duas pessoas, uma ruim: o problema é entre vocês dois', () => {
    expect(judgeCall({ inCall: true, peers: [quality({ level: 'poor' })] }).summary).toContain('entre você e essa pessoa');
  });

  it('o pipoca e o TURN aparecem nos detalhes, sem nomes', () => {
    const check = judgeCall({ inCall: true, peers: [quality({ level: 'fair', concealedPercent: 9, relayed: true })] });
    expect(check.details[0]).toEqual(['Pessoa 1', 'Conexão oscilando (ping 40 ms, perda 0%, oscilação 5 ms, áudio remendado 9%, passando pelo servidor de retransmissão)']);
    expect(check.details).toContainEqual(['Passando pelo servidor de retransmissão', '1 de 1']);
  });
});

describe('formatReport', () => {
  const report = {
    generatedAt: '2026-11-14T15:42:07.000Z',
    checks: [
      judgeApp({
        desktopVersion: '0.7.1',
        userAgent: 'Mozilla/5.0 Electron',
        platform: 'Windows',
        language: 'pt-BR',
        online: true,
        cores: 8,
        memoryGb: 8,
        screen: '1920x1080 (zoom 100%)',
      }),
      judgeServer(server({ socketMs: [220, 225, 230] })),
      judgeMic(mic({ levelDb: -90 })),
    ],
  };

  it('abre com a data e o resumo, e cada teste vira um bloco com o veredito, o conselho e os números', () => {
    const text = formatReport(report);
    expect(text.split('\n').slice(0, 2)).toEqual(['Diagnóstico do Coreto (2026-11-14 15:42 UTC)', 'Resumo: 2 pontos merecem atenção.']);
    expect(text).toContain('[INFO] Este computador: App de desktop 0.7.1');
    expect(text).toContain('[ATENÇÃO] Servidor do Coreto: Conectado, resposta em 225 ms: o servidor está longe de você.');
    expect(text).toContain('  O que fazer: Isso aumenta o atraso das chamadas');
    expect(text).toContain('  - Ida e volta pelo socket: mediana 225 ms, de 220 ms a 230 ms');
  });

  it('o resumo conta problemas antes de avisos', () => {
    expect(summarizeReport({ generatedAt: '', checks: [] }).text).toBe('Tudo certo.');
    const failing = judgeServer(server({ online: false, connected: false }));
    expect(summarizeReport({ generatedAt: '', checks: [failing, judgeMic(mic({ levelDb: -90 }))] })).toMatchObject({ fail: 1, warn: 1, text: 'Um teste encontrou um problema.' });
    expect(summarizeReport({ generatedAt: '', checks: [failing, failing] }).text).toBe('2 testes encontraram problemas.');
  });

  it('não escreve token, senha nem nome de ninguém (só o que as medições carregam)', () => {
    const text = formatReport(report).toLowerCase();
    for (const secret of ['token', 'senha', 'authorization']) expect(text).not.toContain(secret);
  });
});

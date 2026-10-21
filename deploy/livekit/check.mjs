// Confere o servidor de mídia (LiveKit) de fora, sem precisar do segredo:
//   1. o domínio HTTPS responde "OK" (é por ele que o navegador abre o wss://);
//   2. a porta TCP de mídia (7881) aceita conexão;
//
// A porta UDP de mídia (7882) não dá para conferir de fora: o LiveKit só responde a STUN dentro de uma
// sessão de verdade. Teste uma transmissão: o painel de estatísticas mostra "servidor de mídia".
//
//   node deploy/livekit/check.mjs <domínio> <IP-da-VPS>
//   ex.: node deploy/livekit/check.mjs livekit.2.28.229.48.nip.io 2.28.229.48
// Sai com código 1 se alguma checagem falhar.

import net from 'node:net';

const [domain, ip, tcpArg] = process.argv.slice(2);
if (!domain || !ip) {
  console.error('uso: node check.mjs <domínio> <IP-da-VPS> [porta-tcp]');
  process.exit(2);
}
const tcpPort = Number(tcpArg ?? 7881);
const TIMEOUT_MS = 4000;

const checks = [
  ['HTTPS responde', async () => {
    const res = await fetch(`https://${domain}/`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body = (await res.text()).trim();
    if (!res.ok || body !== 'OK') throw new Error(`resposta inesperada: ${res.status} ${body.slice(0, 40)}`);
    return `https://${domain}/ → OK`;
  }],
  [`TCP ${tcpPort} aceita conexão`, () => new Promise((resolve, reject) => {
    const socket = net.connect({ host: ip, port: tcpPort, timeout: TIMEOUT_MS });
    socket.once('connect', () => { socket.destroy(); resolve(`${ip}:${tcpPort} aberto`); });
    socket.once('timeout', () => { socket.destroy(); reject(new Error('sem resposta (porta fechada no firewall?)')); });
    socket.once('error', reject);
  })],
];

let failed = false;
for (const [name, run] of checks) {
  try {
    console.log(`ok   ${name}: ${await run()}`);
  } catch (err) {
    failed = true;
    console.log(`FALHA ${name}: ${err instanceof Error ? err.message : err}`);
  }
}
process.exit(failed ? 1 : 0);

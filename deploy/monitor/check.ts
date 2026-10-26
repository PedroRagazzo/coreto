// Confere o servidor e diz o resultado ao GitHub Actions (variáveis `up` e `detail` em $GITHUB_OUTPUT).
//
//   node deploy/monitor/check.ts https://coreto.exemplo.com
//
// TRIES (padrão 4), WAIT_SECONDS (30) e TIMEOUT_SECONDS (15) ajustam a insistência. Sai com 0 mesmo se o servidor
// está fora do ar: quem decide o que fazer com isso é o workflow (monitor.yml).

import { appendFileSync } from 'node:fs';
import { checkHealth } from './health.ts';

const url = process.argv[2];
if (!url) {
  console.error('Uso: node check.ts <endereço do servidor>');
  process.exit(2);
}

const result = await checkHealth(url, {
  tries: Number(process.env.TRIES) || undefined,
  waitMs: process.env.WAIT_SECONDS ? Number(process.env.WAIT_SECONDS) * 1000 : undefined,
  timeoutMs: process.env.TIMEOUT_SECONDS ? Number(process.env.TIMEOUT_SECONDS) * 1000 : undefined,
});
console.log(result.up ? `no ar (tentativa ${result.attempts})` : `FORA DO AR depois de ${result.attempts} tentativas: ${result.detail}`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `up=${result.up}\ndetail=${result.detail}\n`);

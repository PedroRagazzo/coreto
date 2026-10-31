// Confere o servidor e diz o resultado ao GitHub Actions (variáveis `up`, `detail`, `disk_level` e `disk_detail` em
// $GITHUB_OUTPUT; as do disco ficam vazias se o servidor não informa o uso).
//
//   node deploy/monitor/check.ts https://coreto.exemplo.com
//
// TRIES (padrão 4), WAIT_SECONDS (30) e TIMEOUT_SECONDS (15) ajustam a insistência. Sai com 0 mesmo se o servidor
// está fora do ar: quem decide o que fazer com isso é o workflow (monitor.yml).

import { appendFileSync } from 'node:fs';
import { checkHealth, diskLevel } from './health.ts';

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

// DISK_WARN_PERCENT (padrão 80) e DISK_CRITICAL_PERCENT (90) ajustam quando o disco vira aviso.
const level = result.disk
  ? diskLevel(result.disk.usedPercent, Number(process.env.DISK_WARN_PERCENT) || undefined, Number(process.env.DISK_CRITICAL_PERCENT) || undefined)
  : '';
const gb = (bytes: number) => (bytes / 1024 ** 3).toFixed(1).replace('.', ',');
const diskDetail = result.disk ? `${result.disk.usedPercent}% ocupado, ${gb(result.disk.freeBytes)} GB livres de ${gb(result.disk.totalBytes)} GB` : '';
if (result.up) console.log(result.disk ? `disco: ${diskDetail} (${level})` : 'disco: o servidor não informou');
if (process.env.GITHUB_OUTPUT) {
  const lines = [`up=${result.up}`, `detail=${result.detail}`, `disk_level=${level}`, `disk_detail=${diskDetail}`];
  appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
}

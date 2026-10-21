// Confere um cookies.txt do YouTube antes de montá-lo no servidor.
//
//   npm run check-cookies -w server -- "C:\caminho\cookies.txt"
//   npm run check-cookies -w server -- "C:\caminho\cookies.txt" --limpar "C:\caminho\cookies-limpo.txt"
//   npm run check-cookies -w server -- "C:\caminho\cookies.txt" --testar [--yt-dlp "C:\caminho\yt-dlp.exe"]
//
// Use caminhos completos (o comando roda dentro da pasta server/). Nunca mostra valores de cookie.
//   --limpar   grava uma cópia só com os cookies do YouTube e do Google (os outros sites não precisam ir ao servidor)
//   --testar   confirma com o YouTube, deste computador, que os cookies realmente entram na conta: pede a lista
//              "vídeos curtidos", que só existe para quem está logado. (Ler um vídeo comum não provaria nada daqui,
//              porque o seu IP residencial não é bloqueado.) Isso não testa o IP do servidor, mas pega cookies
//              vencidos, de outra conta ou exportados de um jeito que não loga.

import { execFile } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { musicConfigFromEnv } from '../src/music/config.js';
import { CookieJar } from '../src/music/cookies.js';
import { analyzeCookies, formatReport, onlyYoutubeCookies } from '../src/music/cookies-check.js';

const MAX_BYTES = 2 * 1024 * 1024;

function option(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

/** Roda o yt-dlp e devolve o código de saída e o que ele escreveu como erro (sem nada de cookie). */
function run(command: string, args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((done) => {
    execFile(command, args, { timeout: 90_000, maxBuffer: 20 * 1024 * 1024, windowsHide: true }, (err, _stdout, stderr) => {
      const code = err ? ((err as { code?: unknown }).code === 'ENOENT' ? 127 : typeof (err as { code?: unknown }).code === 'number' ? ((err as { code: number }).code) : 1) : 0;
      done({ code, stderr: String(stderr) });
    });
  });
}

/** O YouTube aceita estes cookies como uma conta logada? */
async function loginWorks(cookiesFile: string): Promise<boolean> {
  const config = { ...musicConfigFromEnv(), cookiesFile, ...(option('--yt-dlp') && { ytdlpPath: option('--yt-dlp')! }) };
  const cookies = new CookieJar(cookiesFile).path(); // o yt-dlp regrava o arquivo; trabalha numa cópia
  const { code, stderr } = await run(config.ytdlpPath, [
    '--ignore-config',
    '--no-warnings',
    '--js-runtimes',
    config.jsRuntimes,
    '--cookies',
    cookies ?? cookiesFile,
    '--flat-playlist',
    '--playlist-end',
    '1',
    '-J',
    'https://www.youtube.com/playlist?list=LL',
  ]);
  if (code === 0) return true;
  if (code === 127) {
    console.error('✗ Não achei o yt-dlp. Informe o caminho com --yt-dlp "C:\\caminho\\yt-dlp.exe" (ou defina YTDLP_PATH).');
  } else if (/does not exist|sign in|log in|login|authenticat|private/i.test(stderr)) {
    console.error('✗ O YouTube não reconheceu uma conta logada com esses cookies (vencidos, de visitante ou mal exportados).');
  } else {
    console.error(`✗ O teste não terminou: ${stderr.trim().split('\n').pop()?.replace(/^ERROR:\s*/i, '').slice(0, 200) ?? 'erro desconhecido'}`);
  }
  return false;
}

const file = process.argv[2] && !process.argv[2].startsWith('--') ? resolve(process.argv[2]) : null;
if (!file) {
  console.error('Uso: npm run check-cookies -w server -- "<caminho do cookies.txt>" [--limpar "<saida>"] [--testar]');
  process.exit(2);
}
if (!existsSync(file) || !statSync(file).isFile()) {
  console.error(`Não achei o arquivo: ${file}`);
  process.exit(2);
}
if (statSync(file).size > MAX_BYTES) {
  console.error('O arquivo é grande demais para ser um cookies.txt do YouTube (mais de 2 MB). Exportou o navegador inteiro?');
  process.exit(2);
}

const text = readFileSync(file, 'utf8');
const report = analyzeCookies(text);
console.log(formatReport(report));

const clean = option('--limpar');
if (clean) {
  const target = resolve(clean);
  if (target === file) {
    console.error('Escolha um arquivo de saída diferente do original.');
    process.exit(2);
  }
  writeFileSync(target, onlyYoutubeCookies(text), { mode: 0o600 });
  console.log(`\nCópia só com YouTube e Google gravada em: ${target}`);
  console.log('Use esta cópia no servidor e apague o original quando não precisar mais dele.');
}

let tested = true;
if (process.argv.includes('--testar')) {
  if (!report.ok) {
    console.error('\nCorrija os problemas antes de testar com o YouTube.');
    process.exit(1);
  }
  console.log('\nTestando o login com o YouTube (pode levar alguns segundos)...');
  tested = await loginWorks(clean ? resolve(clean) : file);
  if (tested) console.log('✓ O YouTube reconheceu a conta logada. Os cookies estão bons.');
}

process.exit(report.ok && tested ? 0 : 1);

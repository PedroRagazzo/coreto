// Confere um cookies.txt do YouTube antes de ele ir para o servidor. Nada aqui devolve valores de cookie:
// só nomes, contagens e datas, para o relatório poder ser colado numa conversa sem vazar a sessão.

/** Cookies que provam uma sessão logada no Google/YouTube. */
const SESSION_COOKIES = ['SID', 'HSID', 'SSID', 'APISID', 'SAPISID', '__Secure-1PSID', '__Secure-3PSID', '__Secure-1PAPISID', '__Secure-3PAPISID'];
/** O principal que o yt-dlp usa para saber que há uma conta logada. */
const LOGIN_INFO = 'LOGIN_INFO';

export interface CookieReport {
  /** Pode ir para o servidor. */
  ok: boolean;
  /** O que impede de funcionar. */
  problems: string[];
  /** O que pode dar errado ou expor mais do que o necessário. */
  warnings: string[];
  total: number;
  youtube: number;
  google: number;
  others: number;
  /** Cookies de sessão presentes e ausentes (só os nomes). */
  present: string[];
  missing: string[];
  /** Data em que o primeiro cookie de sessão importante expira, se algum expira. */
  firstExpiry: Date | null;
  crlf: boolean;
}

interface Cookie {
  domain: string;
  secure: boolean;
  expires: number;
  name: string;
}

const HTTP_ONLY_PREFIX = '#HttpOnly_';

/** Lê as linhas no formato Netscape; devolve também quantas linhas não são cookies válidos. */
function parse(text: string): { cookies: Cookie[]; invalid: number; header: boolean } {
  const cookies: Cookie[] = [];
  let invalid = 0;
  let header = false;
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    let line = raw.trim();
    if (!line) continue;
    if (/^#\s*(Netscape )?HTTP Cookie File/i.test(line)) {
      header = true;
      continue;
    }
    // Cookies "HttpOnly" vêm escritos como comentário; são cookies de verdade.
    if (line.startsWith(HTTP_ONLY_PREFIX)) line = line.slice('#HttpOnly_'.length);
    else if (line.startsWith('#')) continue;
    const fields = line.split('\t');
    if (fields.length !== 7) {
      invalid++;
      continue;
    }
    const [domain, , , secure, expires, name] = fields;
    cookies.push({ domain: domain.toLowerCase(), secure: secure.toUpperCase() === 'TRUE', expires: Number(expires) || 0, name });
  }
  return { cookies, invalid, header };
}

const isYoutube = (domain: string) => domain === 'youtube.com' || domain.endsWith('.youtube.com');
const isGoogle = (domain: string) => domain === 'google.com' || domain.endsWith('.google.com');

export function analyzeCookies(text: string, nowSeconds = Date.now() / 1000): CookieReport {
  const { cookies, invalid, header } = parse(text);
  const problems: string[] = [];
  const warnings: string[] = [];

  const youtube = cookies.filter((c) => isYoutube(c.domain));
  const google = cookies.filter((c) => isGoogle(c.domain));
  const others = cookies.length - youtube.length - google.length;

  if (cookies.length === 0) {
    problems.push('Não achei nenhum cookie. O arquivo precisa estar no formato Netscape (uma linha por cookie, com 7 colunas separadas por tab).');
  } else if (youtube.length + google.length === 0) {
    problems.push('Não há cookies de youtube.com nem de google.com. Exporte os cookies com o YouTube aberto na aba.');
  }
  if (!header && cookies.length > 0) {
    warnings.push('Falta a primeira linha "# Netscape HTTP Cookie File"; o yt-dlp pode recusar o arquivo. Adicione-a (ou use --limpar para gerar uma cópia certa).');
  }
  if (invalid > 0) warnings.push(`${invalid} linha(s) não parecem cookies (formato errado) e serão ignoradas.`);

  const session = [...youtube, ...google].filter((c) => SESSION_COOKIES.includes(c.name));
  const present = SESSION_COOKIES.filter((name) => session.some((c) => c.name === name));
  const missing = SESSION_COOKIES.filter((name) => !present.includes(name));
  if (cookies.length > 0 && youtube.length + google.length > 0) {
    if (present.length === 0) {
      problems.push('Nenhum cookie de sessão (SID, __Secure-3PSID...). Provavelmente você exportou sem estar logado na conta Google.');
    } else if (!youtube.some((c) => c.name === LOGIN_INFO)) {
      warnings.push('Falta o cookie LOGIN_INFO de youtube.com. Abra o YouTube já logado, na mesma aba, e exporte de novo.');
    }
  }

  const expiring = session.filter((c) => c.expires > 0);
  const expired = expiring.filter((c) => c.expires < nowSeconds);
  if (expired.length > 0 && expired.length === expiring.length && present.length > 0) {
    problems.push('Todos os cookies de sessão já expiraram. Entre na conta de novo e exporte outra vez.');
  } else if (expired.length > 0) {
    warnings.push(`${expired.length} cookie(s) de sessão já expiraram (${[...new Set(expired.map((c) => c.name))].join(', ')}).`);
  }
  const future = expiring.filter((c) => c.expires >= nowSeconds).map((c) => c.expires);
  const firstExpiry = future.length > 0 ? new Date(Math.min(...future) * 1000) : null;

  if (others > 0) {
    warnings.push(
      `O arquivo tem ${others} cookie(s) de outros sites. Eles não são necessários e iriam junto para o servidor: gere uma cópia só com YouTube e Google usando --limpar.`,
    );
  }
  const crlf = text.includes('\r\n');
  if (crlf) warnings.push('O arquivo tem quebras de linha do Windows; em geral funciona, mas --limpar gera uma cópia no formato certo.');

  return {
    ok: problems.length === 0,
    problems,
    warnings,
    total: cookies.length,
    youtube: youtube.length,
    google: google.length,
    others,
    present,
    missing,
    firstExpiry,
    crlf,
  };
}

/** Uma cópia só com os cookies do YouTube e do Google, com o cabeçalho certo e quebras de linha Unix. */
export function onlyYoutubeCookies(text: string): string {
  const keep: string[] = ['# Netscape HTTP Cookie File'];
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    let line = raw.trim();
    if (!line) continue;
    const httpOnly = line.startsWith(HTTP_ONLY_PREFIX);
    if (httpOnly) line = line.slice(HTTP_ONLY_PREFIX.length);
    else if (line.startsWith('#')) continue;
    const fields = line.split('\t');
    if (fields.length !== 7) continue;
    const domain = fields[0].toLowerCase();
    if (isYoutube(domain) || isGoogle(domain)) keep.push((httpOnly ? HTTP_ONLY_PREFIX : '') + line);
  }
  return keep.join('\n') + '\n';
}

/** O relatório em texto, pronto para o terminal. */
export function formatReport(report: CookieReport): string {
  const lines: string[] = [];
  lines.push(`Cookies: ${report.total} no total (YouTube: ${report.youtube}, Google: ${report.google}, outros sites: ${report.others}).`);
  lines.push(`Sessão encontrada: ${report.present.length > 0 ? report.present.join(', ') : 'nenhuma'}.`);
  if (report.present.length > 0 && report.missing.length > 0) lines.push(`Não encontrados (normal faltar alguns): ${report.missing.join(', ')}.`);
  if (report.firstExpiry) lines.push(`O primeiro cookie de sessão expira em ${report.firstExpiry.toLocaleDateString('pt-BR')}.`);
  for (const problem of report.problems) lines.push(`✗ PROBLEMA: ${problem}`);
  for (const warning of report.warnings) lines.push(`! Aviso: ${warning}`);
  lines.push(
    report.ok
      ? '✓ A estrutura do arquivo está certa. Isto ainda não prova que o YouTube aceita a conta: rode de novo com --testar.'
      : '✗ Corrija os problemas acima e exporte de novo.',
  );
  return lines.join('\n');
}

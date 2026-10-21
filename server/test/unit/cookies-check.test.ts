import { describe, expect, it } from 'vitest';
import { analyzeCookies, formatReport, onlyYoutubeCookies } from '../../src/music/cookies-check.js';

const NOW = 1_800_000_000; // segundos
const FUTURE = NOW + 90 * 86400;
const PAST = NOW - 86400;

/** Uma linha no formato Netscape: domínio, subdomínios, caminho, seguro, expira, nome, valor. */
const row = (domain: string, name: string, expires = FUTURE, httpOnly = false) =>
  `${httpOnly ? '#HttpOnly_' : ''}${domain}\tTRUE\t/\tTRUE\t${expires}\t${name}\tVALOR-SECRETO-${name}`;

const HEADER = '# Netscape HTTP Cookie File';

const loggedIn = [
  row('.youtube.com', 'LOGIN_INFO'),
  row('.youtube.com', 'VISITOR_INFO1_LIVE'),
  row('.google.com', 'SID'),
  row('.google.com', '__Secure-1PSID', FUTURE, true),
  row('.google.com', '__Secure-3PSID', FUTURE, true),
  row('.google.com', 'SAPISID'),
];

describe('conferência do cookies.txt do YouTube', () => {
  it('aprova um arquivo de conta logada, conta cada tipo de cookie e diz quando expira', () => {
    const report = analyzeCookies([HEADER, ...loggedIn].join('\n'), NOW);
    expect(report.ok).toBe(true);
    expect(report.problems).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.total).toBe(6);
    expect(report.youtube).toBe(2);
    expect(report.google).toBe(4);
    expect(report.present).toEqual(['SID', 'SAPISID', '__Secure-1PSID', '__Secure-3PSID']);
    expect(report.firstExpiry?.getTime()).toBe(FUTURE * 1000);
  });

  it('o relatório nunca mostra valores de cookie', () => {
    const text = formatReport(analyzeCookies([HEADER, ...loggedIn].join('\n'), NOW));
    expect(text).not.toContain('VALOR-SECRETO');
    expect(text).toContain('✓');
  });

  it('recusa arquivo vazio, em outro formato ou sem cookies do YouTube', () => {
    expect(analyzeCookies('', NOW).ok).toBe(false);
    expect(analyzeCookies('{"json": true}', NOW).ok).toBe(false);
    const other = analyzeCookies([HEADER, row('.exemplo.com', 'sessao')].join('\n'), NOW);
    expect(other.ok).toBe(false);
    expect(other.problems.join(' ')).toContain('youtube.com nem de google.com');
  });

  it('recusa quem exportou sem estar logado (só cookies de visitante)', () => {
    const report = analyzeCookies([HEADER, row('.youtube.com', 'VISITOR_INFO1_LIVE'), row('.youtube.com', 'YSC')].join('\n'), NOW);
    expect(report.ok).toBe(false);
    expect(report.problems.join(' ')).toContain('logado');
  });

  it('recusa sessão toda vencida e avisa quando só parte venceu', () => {
    const expired = analyzeCookies([HEADER, row('.youtube.com', 'LOGIN_INFO'), row('.google.com', 'SID', PAST), row('.google.com', '__Secure-3PSID', PAST)].join('\n'), NOW);
    expect(expired.ok).toBe(false);
    expect(expired.problems.join(' ')).toContain('expiraram');

    const partial = analyzeCookies([HEADER, row('.youtube.com', 'LOGIN_INFO'), row('.google.com', 'SID', PAST), row('.google.com', '__Secure-3PSID')].join('\n'), NOW);
    expect(partial.ok).toBe(true);
    expect(partial.warnings.join(' ')).toContain('SID');
  });

  it('avisa de cabeçalho ausente, linhas inválidas, cookies de outros sites e quebras do Windows', () => {
    const text = [...loggedIn, 'isto não é um cookie', row('.banco.com.br', 'sessao'), row('.outro.com', 'x')].join('\r\n');
    const report = analyzeCookies(text, NOW);
    expect(report.ok).toBe(true);
    expect(report.others).toBe(2);
    const warnings = report.warnings.join(' | ');
    expect(warnings).toContain('Netscape');
    expect(warnings).toContain('1 linha');
    expect(warnings).toContain('2 cookie(s) de outros sites');
    expect(warnings).toContain('Windows');
  });

  it('avisa quando falta o LOGIN_INFO', () => {
    const report = analyzeCookies([HEADER, row('.google.com', 'SID'), row('.google.com', '__Secure-3PSID')].join('\n'), NOW);
    expect(report.ok).toBe(true);
    expect(report.warnings.join(' ')).toContain('LOGIN_INFO');
  });

  it('a cópia limpa fica só com YouTube e Google, mantém os HttpOnly e usa o cabeçalho e as quebras certas', () => {
    const mixed = [...loggedIn, row('.banco.com.br', 'sessao'), row('exemplo.com', 'x')].join('\r\n');
    const clean = onlyYoutubeCookies(mixed);
    expect(clean.startsWith(`${HEADER}\n`)).toBe(true);
    expect(clean).not.toContain('\r');
    expect(clean).not.toContain('banco.com.br');
    expect(clean).not.toContain('exemplo.com');
    expect(clean).toContain('#HttpOnly_.google.com\tTRUE\t/\tTRUE');
    const report = analyzeCookies(clean, NOW);
    expect(report.ok).toBe(true);
    expect(report.warnings).toEqual([]);
    expect(report.total).toBe(6);
  });

  it('não confunde domínios parecidos com o do YouTube', () => {
    const fake = analyzeCookies([HEADER, row('.naoyoutube.com', 'SID'), row('.youtube.com.golpe.net', '__Secure-3PSID')].join('\n'), NOW);
    expect(fake.youtube + fake.google).toBe(0);
    expect(fake.ok).toBe(false);
  });
});

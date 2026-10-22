// Endereços de IP que o servidor aceita buscar por conta de um link: só os públicos. Tudo que é da rede interna
// (a própria VPS, o banco, o painel do Dokploy, o endereço de metadados da nuvem) fica de fora, senão um link
// numa mensagem faria o servidor visitar esses lugares e mostrar o que achou.

import { isIP } from 'node:net';

const v4 = (ip: string): number[] => ip.split('.').map(Number);

/** (início, tamanho do prefixo) de cada faixa IPv4 que não é da internet pública. */
const BLOCKED_V4: [string, number][] = [
  ['0.0.0.0', 8], // "esta rede"
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // compartilhado das operadoras (CGNAT)
  ['127.0.0.0', 8], // a própria máquina
  ['169.254.0.0', 16], // link-local, inclusive os metadados da nuvem (169.254.169.254)
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24], // documentação
  ['192.168.0.0', 16],
  ['198.18.0.0', 15], // testes de desempenho
  ['198.51.100.0', 24], // documentação
  ['203.0.113.0', 24], // documentação
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reservado e broadcast
];

const toNumber = ([a, b, c, d]: number[]) => ((a * 256 + b) * 256 + c) * 256 + d;

function publicV4(ip: string): boolean {
  const parts = v4(ip);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return false;
  const n = toNumber(parts);
  return !BLOCKED_V4.some(([start, bits]) => {
    const size = 2 ** (32 - bits);
    const first = toNumber(v4(start));
    return n >= first && n < first + size;
  });
}

/** Os 8 grupos de 16 bits de um IPv6 (aceita "::" e o final em IPv4). */
function groupsOfV6(ip: string): number[] | null {
  let text = ip.toLowerCase().split('%')[0];
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (tail) {
    const [a, b, c, d] = v4(tail[1]);
    if ([a, b, c, d].some((p) => !(p >= 0 && p <= 255))) return null;
    text = `${text.slice(0, -tail[1].length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...rest].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

const embeddedV4 = (high: number, low: number) => `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;

function publicV6(ip: string): boolean {
  const g = groupsOfV6(ip);
  if (!g) return false;
  // ::ffff:a.b.c.d (IPv4 dentro de IPv6) e o prefixo de tradução 64:ff9b::/96: vale a regra do IPv4 embutido.
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return publicV4(embeddedV4(g[6], g[7]));
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return publicV4(embeddedV4(g[6], g[7]));
  // 6to4 (2002::/16) carrega um IPv4 nos bits seguintes.
  if (g[0] === 0x2002) return publicV4(embeddedV4(g[1], g[2]));
  if (g.every((x) => x === 0)) return false; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return false; // ::1
  if ((g[0] & 0xfe00) === 0xfc00) return false; // fc00::/7, endereços locais únicos
  if ((g[0] & 0xffc0) === 0xfe80) return false; // fe80::/10, link-local
  if ((g[0] & 0xffc0) === 0xfec0) return false; // fec0::/10, antigo site-local
  if ((g[0] & 0xff00) === 0xff00) return false; // ff00::/8, multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // documentação
  if (g[0] === 0x2001 && g[1] === 0) return false; // Teredo
  return true;
}

/** É um endereço da internet pública (e não da rede interna, da própria máquina ou reservado)? */
export function isPublicAddress(ip: string): boolean {
  const kind = isIP(ip);
  return kind === 4 ? publicV4(ip) : kind === 6 ? publicV6(ip) : false;
}

// Busca de uma página ou imagem a pedido de um link, com as defesas de quem aceita endereços de estranhos:
//   - só http e https, sem usuário e senha no endereço, e só nas portas 80 e 443;
//   - o nome do site é resolvido aqui e TODOS os endereços precisam ser públicos (address.ts); a conexão vai
//     para o endereço já conferido, então o DNS não pode trocar de resposta no meio ("DNS rebinding");
//   - cada redirecionamento passa pelas mesmas conferências (no máximo 3);
//   - tempo total e tamanho lido têm limite, também depois de descomprimir.

import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpRequest, type IncomingHttpHeaders, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import { isPublicAddress } from './address.js';

/** O endereço não é seguro de visitar (rede interna, porta estranha...). A mensagem é só para o log. */
export class UnsafeUrlError extends Error {}

const USER_AGENT = 'Mozilla/5.0 (compatible; CoretoBot/1.0; +link-preview)';
const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 3;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const BLOCKED_NAMES = /(^|\.)(localhost|local|internal|lan|intranet|home\.arpa)$/i;

export interface SafeGetOptions {
  /** Quantos bytes ler do corpo, olhando status e cabeçalhos; `null` recusa a resposta sem ler nada. */
  limit(response: { status: number; headers: IncomingHttpHeaders }): number | null;
  accept?: string;
  timeoutMs?: number;
  /** Só para testes: aceita endereços da rede interna e portas quaisquer. */
  allowPrivate?: boolean;
}

export interface SafeResponse {
  status: number;
  headers: IncomingHttpHeaders;
  /** O endereço final, depois dos redirecionamentos. */
  url: string;
  body: Buffer;
  /** O corpo era maior que o limite e foi cortado. */
  truncated: boolean;
}

const bare = (hostname: string) => hostname.replace(/^\[|\]$/g, '');

/** Confere o endereço e devolve o IP para onde conectar. */
async function resolveSafely(url: URL, allowPrivate: boolean): Promise<{ address: string; family: 4 | 6 }> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new UnsafeUrlError(`protocolo ${url.protocol}`);
  if (url.username || url.password) throw new UnsafeUrlError('usuário e senha no endereço');
  if (!allowPrivate && url.port && url.port !== '80' && url.port !== '443') throw new UnsafeUrlError(`porta ${url.port}`);
  const host = bare(url.hostname);
  if (!allowPrivate && BLOCKED_NAMES.test(host)) throw new UnsafeUrlError(`nome interno ${host}`);

  const kind = isIP(host);
  const addresses = kind ? [{ address: host, family: kind as 4 | 6 }] : await dnsLookup(host, { all: true, verbatim: true });
  if (addresses.length === 0) throw new UnsafeUrlError('sem endereço');
  if (!allowPrivate) {
    const blocked = addresses.find((a) => !isPublicAddress(a.address));
    if (blocked) throw new UnsafeUrlError(`${host} aponta para ${blocked.address}`);
  }
  return { address: addresses[0].address, family: addresses[0].family as 4 | 6 };
}

function open(url: URL, pinned: { address: string; family: 4 | 6 }, options: SafeGetOptions, signal: AbortSignal): Promise<IncomingMessage> {
  const secure = url.protocol === 'https:';
  const host = bare(url.hostname);
  return new Promise((resolve, reject) => {
    const req = (secure ? httpsRequest : httpRequest)(
      {
        hostname: host,
        port: url.port || (secure ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        signal,
        headers: {
          host: url.host,
          'user-agent': USER_AGENT,
          accept: options.accept ?? '*/*',
          'accept-encoding': 'gzip, deflate, br',
          'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8',
        },
        // A conexão vai para o endereço que acabamos de conferir, não para o que o DNS responder agora.
        lookup: (_name, lookupOptions, callback) => {
          const result = { address: pinned.address, family: pinned.family };
          if ((lookupOptions as { all?: boolean }).all) (callback as unknown as (e: null, a: unknown[]) => void)(null, [result]);
          else callback(null, result.address, result.family);
        },
        ...(secure && !isIP(host) && { servername: host }),
      },
      resolve,
    );
    req.on('error', reject);
    req.end();
  });
}

/** O corpo, descomprimido se preciso, até `limit` bytes. */
async function readBody(response: IncomingMessage, limit: number): Promise<{ body: Buffer; truncated: boolean }> {
  const encoding = String(response.headers['content-encoding'] ?? '').toLowerCase();
  const decoder = encoding.includes('br') ? createBrotliDecompress() : encoding.includes('gzip') ? createGunzip() : encoding.includes('deflate') ? createInflate() : null;
  const source = decoder ? response.pipe(decoder) : response;
  const chunks: Buffer[] = [];
  let size = 0;
  let truncated = false;
  try {
    for await (const chunk of source) {
      const piece = chunk as Buffer;
      const room = limit - size;
      chunks.push(piece.length > room ? piece.subarray(0, room) : piece);
      size += Math.min(piece.length, room);
      if (piece.length >= room) {
        truncated = true;
        break;
      }
    }
  } finally {
    response.destroy();
    decoder?.destroy();
  }
  return { body: Buffer.concat(chunks), truncated };
}

/**
 * Busca o endereço. Devolve `null` se `limit` recusou a resposta ou se acabou em redirecionamentos demais;
 * lança `UnsafeUrlError` para endereço inseguro e outros erros para falha de rede ou tempo esgotado.
 */
export async function safeGet(address: string, options: SafeGetOptions): Promise<SafeResponse | null> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const allowPrivate = options.allowPrivate ?? false;
  const deadline = Date.now() + timeoutMs;
  let current = new URL(address);
  const controller = new AbortController();

  const work = (async (): Promise<SafeResponse | null> => {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const pinned = await resolveSafely(current, allowPrivate);
      const response = await open(current, pinned, options, controller.signal);
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      if (REDIRECTS.has(status) && location) {
        response.destroy();
        current = new URL(location, current);
        continue;
      }
      const limit = options.limit({ status, headers: response.headers });
      if (limit === null) {
        response.destroy();
        return null;
      }
      const { body, truncated } = await readBody(response, limit);
      return { status, headers: response.headers, url: current.toString(), body, truncated };
    }
    return null;
  })();

  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(); // fecha a conexão que ficou pendurada
      reject(new Error('tempo esgotado'));
    }, Math.max(1, deadline - Date.now()));
  });
  try {
    return await Promise.race([work, expired]);
  } finally {
    clearTimeout(timer);
    work.catch(() => undefined); // se o tempo estourou, a falha tardia do trabalho não pode virar erro solto
  }
}

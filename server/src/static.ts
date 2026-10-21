// Em produção o mesmo servidor entrega o site (client/dist), a API e o
// socket.io: tudo na mesma origem, sem CORS e com um endereço só.

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * Política de conteúdo do site: só scripts próprios (e WebAssembly); imagens e mídia também de
 * `blob:` (prévias de anexos e vídeo da chamada); WebSocket para o socket.io.
 */
export const contentSecurityPolicy = (connectOrigins: string[] = []): string =>
  [
    "default-src 'self'",
    // 'wasm-unsafe-eval': só WebAssembly (o RNNoise do cancelamento de ruído); não libera eval() de texto.
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    // `connectOrigins`: o servidor de mídia (LiveKit), que além do WebSocket faz um GET de diagnóstico por HTTP(S).
    ['connect-src', "'self'", 'ws:', 'wss:', ...connectOrigins].join(' '),
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');

/** Entrega um arquivo do build; caminhos sem arquivo caem no index.html (app de página única). */
export async function serveClient(
  req: IncomingMessage,
  res: ServerResponse,
  distDir: string,
  connectOrigins: string[] = [],
): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return void res.writeHead(405).end();
  const root = resolve(distDir);
  let path: string;
  try {
    path = decodeURIComponent((req.url ?? '/').split('?')[0]);
  } catch {
    return void res.writeHead(400).end();
  }
  const file = resolve(join(root, normalize(path)));
  if (file !== root && !file.startsWith(root + sep)) return void res.writeHead(404).end();

  const found = await stat(file).then((s) => (s.isFile() ? file : null), () => null);
  // Rotas do app não têm extensão; arquivo com extensão que não existe é 404 de verdade.
  const target = found ?? (extname(path) ? null : join(root, 'index.html'));
  if (!target) return void res.writeHead(404).end();

  const isHtml = target.endsWith('.html');
  res.writeHead(200, {
    'content-type': TYPES[extname(target)] ?? 'application/octet-stream',
    // Arquivos de /assets têm hash no nome e nunca mudam; o index.html sempre é revalidado.
    'cache-control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...(isHtml && { 'content-security-policy': contentSecurityPolicy(connectOrigins) }),
  });
  if (req.method === 'HEAD') return void res.end();
  createReadStream(target).pipe(res);
}

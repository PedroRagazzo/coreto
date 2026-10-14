import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serveClient } from '../../src/static.js';

describe('serveClient', () => {
  let root: string;
  let dist: string;
  let server: Server;
  let base: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'coreto-site-'));
    dist = join(root, 'dist');
    await mkdir(join(dist, 'assets'), { recursive: true });
    await writeFile(join(dist, 'index.html'), '<!doctype html><title>Coreto</title>');
    await writeFile(join(dist, 'assets', 'app-abc123.js'), 'console.log(1)');
    await writeFile(join(root, 'segredo.txt'), 'fora do site');
    server = createServer((req, res) => void serveClient(req, res, dist));
    await new Promise<void>((resolve) => server.listen(0, resolve));
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });

  it('entrega o index.html com a política de segurança e sem cache longo', async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('content-security-policy')).toContain("script-src 'self'");
    expect(res.headers.get('cache-control')).toBe('no-cache');
  });

  it('guarda os arquivos de /assets em cache para sempre', async () => {
    const res = await fetch(`${base}/assets/app-abc123.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/javascript');
    expect(res.headers.get('cache-control')).toContain('immutable');
  });

  it('cai no index.html em rotas do app, mas não em arquivos que faltam', async () => {
    expect(await (await fetch(`${base}/canal/qualquer`)).text()).toContain('<title>Coreto</title>');
    expect((await fetch(`${base}/assets/sumiu.js`)).status).toBe(404);
  });

  it('não deixa sair da pasta do site', async () => {
    // fetch normaliza "../"; o pedido cru chega como o navegador malicioso mandaria.
    const raw = (path: string) =>
      new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = request(`${base}${path}`, (res) => {
          let body = '';
          res.on('data', (chunk: Buffer) => (body += chunk.toString()));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
        });
        req.on('error', reject);
        req.end();
      });
    for (const path of ['/../segredo.txt', '/..%2fsegredo.txt', '/%2e%2e/segredo.txt']) {
      const res = await raw(path);
      expect(res.body).not.toContain('fora do site');
    }
  });
});

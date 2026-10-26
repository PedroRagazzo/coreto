import { describe, expect, it, vi } from 'vitest';
import { checkHealth } from '../../../deploy/monitor/health.js';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const noWait = { sleep: () => Promise.resolve(), waitMs: 0 };

describe('checkHealth', () => {
  it('está no ar quando /health responde 200 com ok', async () => {
    const get = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => json({ ok: true }));
    expect(await checkHealth('https://coreto.exemplo.com/', { fetch: get, ...noWait })).toEqual({ up: true, attempts: 1, detail: '' });
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0]![0]).toBe('https://coreto.exemplo.com/health'); // sem barra dupla
  });

  it('um deploy que derruba o servidor por um instante não vira alarme: tenta de novo e acha no ar', async () => {
    const answers = [() => json({}, 502), () => json({}, 503), () => json({ ok: true })];
    const get = vi.fn(async () => answers.shift()!());
    const sleep = vi.fn(() => Promise.resolve());
    expect(await checkHealth('https://x', { fetch: get, sleep, waitMs: 30_000 })).toMatchObject({ up: true, attempts: 3 });
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(30_000);
  });

  it('fora do ar depois de todas as tentativas, dizendo o motivo da última', async () => {
    const get = vi.fn(async () => json({}, 502));
    const result = await checkHealth('https://x', { fetch: get, tries: 3, ...noWait });
    expect(result).toEqual({ up: false, attempts: 3, detail: 'HTTP 502' });
    expect(get).toHaveBeenCalledTimes(3);
  });

  it('não espera depois da última tentativa', async () => {
    const sleep = vi.fn(() => Promise.resolve());
    await checkHealth('https://x', { fetch: async () => json({}, 500), tries: 2, sleep, waitMs: 1 });
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('conexão recusada: o motivo é o código do erro', async () => {
    const refused = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    const result = await checkHealth('https://x', { fetch: async () => Promise.reject(refused), tries: 1, ...noWait });
    expect(result).toEqual({ up: false, attempts: 1, detail: 'ECONNREFUSED' });
  });

  it('sem resposta (tempo esgotado) é fora do ar', async () => {
    const slow = (_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)));
    const result = await checkHealth('https://x', { fetch: slow as typeof fetch, tries: 1, timeoutMs: 30, ...noWait });
    expect(result).toEqual({ up: false, attempts: 1, detail: 'sem resposta (tempo esgotado)' });
  });

  it('uma página qualquer com status 200 (um proxy no lugar do servidor) não conta como no ar', async () => {
    const result = await checkHealth('https://x', { fetch: async () => new Response('<html>Bad gateway</html>', { status: 200 }), tries: 1, ...noWait });
    expect(result).toEqual({ up: false, attempts: 1, detail: 'resposta inesperada de /health' });
    const notOk = await checkHealth('https://x', { fetch: async () => json({ ok: false }), tries: 1, ...noWait });
    expect(notOk.up).toBe(false);
  });
});

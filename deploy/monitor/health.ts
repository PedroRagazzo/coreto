// Confere se o servidor do Coreto está de pé: GET /health precisa responder 200 com `{"ok":true}`. Tenta algumas vezes,
// com espera entre elas, para um deploy (que derruba o servidor por um ou dois minutos) ou um soluço de rede não virar
// alarme. Sem dependências: roda direto no Node (`node check.ts`) e nos testes.

export interface HealthResult {
  up: boolean;
  attempts: number;
  /** Por que falhou na última tentativa (vazio se está de pé). */
  detail: string;
}

export interface HealthOptions {
  tries?: number;
  waitMs?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export async function checkHealth(baseUrl: string, options: HealthOptions = {}): Promise<HealthResult> {
  const { tries = 4, waitMs = 30_000, timeoutMs = 15_000, fetch: get = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = options;
  const url = `${baseUrl.replace(/\/+$/, '')}/health`;
  let detail = '';
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await get(url, { signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': 'coreto-monitor' } });
      if (res.ok) {
        const body = (await res.json().catch(() => null)) as { ok?: unknown } | null;
        if (body?.ok === true) return { up: true, attempts: attempt, detail: '' };
        detail = 'resposta inesperada de /health';
      } else {
        detail = `HTTP ${res.status}`;
      }
    } catch (err) {
      const cause = (err as { cause?: { code?: string } }).cause?.code;
      detail = err instanceof DOMException && err.name === 'TimeoutError' ? 'sem resposta (tempo esgotado)' : (cause ?? (err as Error).message);
    }
    if (attempt < tries) await sleep(waitMs);
  }
  return { up: false, attempts: tries, detail };
}

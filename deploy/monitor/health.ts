// Confere se o servidor do Coreto está de pé: GET /health precisa responder 200 com `{"ok":true}`. Tenta algumas vezes,
// com espera entre elas, para um deploy (que derruba o servidor por um ou dois minutos) ou um soluço de rede não virar
// alarme. Também lê o uso do disco que o servidor informa em /health. Sem dependências: roda direto no Node (`node check.ts`) e nos testes.

export interface DiskReport {
  usedPercent: number;
  freeBytes: number;
  totalBytes: number;
}

export interface HealthResult {
  up: boolean;
  attempts: number;
  /** Por que falhou na última tentativa (vazio se está de pé). */
  detail: string;
  /** O uso do disco da VPS, quando o servidor informa (versões antigas dele não informam). */
  disk?: DiskReport;
}

export type DiskLevel = 'ok' | 'warn' | 'critical';

/** Percentuais de ocupação a partir dos quais o disco merece aviso e aviso urgente. */
export const DISK_WARN_PERCENT = 80;
export const DISK_CRITICAL_PERCENT = 90;

export function diskLevel(usedPercent: number, warn = DISK_WARN_PERCENT, critical = DISK_CRITICAL_PERCENT): DiskLevel {
  if (usedPercent >= critical) return 'critical';
  return usedPercent >= warn ? 'warn' : 'ok';
}

/** O `disk` do corpo de /health, só se vier completo e com números de verdade. */
export function parseDisk(value: unknown): DiskReport | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { usedPercent, freeBytes, totalBytes } = value as Record<string, unknown>;
  const valid = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  if (!valid(usedPercent) || usedPercent > 100 || !valid(freeBytes) || !valid(totalBytes)) return undefined;
  return { usedPercent, freeBytes, totalBytes };
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
        const body = (await res.json().catch(() => null)) as { ok?: unknown; disk?: unknown } | null;
        if (body?.ok === true) {
          const disk = parseDisk(body.disk);
          return { up: true, attempts: attempt, detail: '', ...(disk && { disk }) };
        }
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

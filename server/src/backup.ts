// Backup do banco: uma cópia do PostgreSQL (pg_dump, formato custom, já compactado) por dia, mais um espelho das
// anexos pequenos (imagens e arquivos até 8 MB), que o banco não guarda. Roda dentro do próprio servidor, sem agendamento de fora.
//
// As cópias ficam em BACKUP_DIR (um volume): protegem contra erro humano e banco corrompido, não contra perder a VPS.
// A senha do banco nunca vai na linha de comando (apareceria em `ps` e em mensagens de erro): vai pelo ambiente do pg_dump.

import { execFile } from 'node:child_process';
import { copyFile, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { MAX_IMAGE_BYTES } from '../../shared/src/protocol.js';

const DAY_MS = 24 * 60 * 60_000;
const DUMP_NAME = /^coreto-(\d{8})-(\d{6})\.dump$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Anexos maiores que isso não entram no espelho: arquivos grandes dobrariam o espaço usado no disco. */
const MIRROR_MAX_FILE_BYTES = MAX_IMAGE_BYTES;
/** Quanto tempo uma imagem apagada do servidor ainda fica no espelho (ela pode estar numa cópia do banco que você restaure). */
const MIRROR_GRACE_MS = 30 * DAY_MS;
/** Depois de uma falha, tenta de novo daqui a pouco, e não só no dia seguinte. */
const RETRY_MS = 60 * 60_000;
/** Ao subir, se a última cópia é velha, espera o servidor assentar (e um deploy em série passar) antes de copiar. */
const CATCH_UP_DELAY_MS = 2 * 60_000;
const DUMP_TIMEOUT_MS = 30 * 60_000;
const UPLOADS_SUBDIR = 'uploads';

export interface BackupConfig {
  dir: string;
  /** Quantas cópias do banco guardar; as mais antigas são apagadas. */
  keep: number;
  /** Hora (UTC) da cópia diária. */
  hourUtc: number;
  databaseUrl: string;
  /** Pasta das imagens enviadas, para espelhar junto; `null` não espelha. */
  uploadDir: string | null;
}

/**
 * Lê a configuração do ambiente. Sem `BACKUP_DIR` (como no desenvolvimento), ou com `BACKUP_AUTO=false`, o backup
 * automático fica desligado; `npm run backup` ainda funciona.
 */
export function backupConfigFromEnv(env: NodeJS.ProcessEnv, uploadDir: string | null): BackupConfig | null {
  const dir = env.BACKUP_DIR?.trim();
  const databaseUrl = env.DATABASE_URL;
  if (!dir || !databaseUrl || env.BACKUP_AUTO?.trim().toLowerCase() === 'false') return null;
  return {
    dir,
    keep: integerIn(env.BACKUP_KEEP, 14, 1, 365),
    // 06:00 UTC = 03:00 em Brasília: a hora de menos movimento.
    hourUtc: integerIn(env.BACKUP_HOUR_UTC, 6, 0, 23),
    databaseUrl,
    uploadDir,
  };
}

function integerIn(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  return raw?.trim() && Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

/** Os argumentos e o ambiente do pg_dump para uma DATABASE_URL, sem a URL (nem a senha) na linha de comando. */
export function pgConnection(databaseUrl: string): { args: string[]; env: Record<string, string> } {
  const url = new URL(databaseUrl);
  const args = ['--dbname', decodeURIComponent(url.pathname.replace(/^\//, ''))];
  if (url.hostname) args.push('--host', url.hostname);
  if (url.port) args.push('--port', url.port);
  if (url.username) args.push('--username', decodeURIComponent(url.username));
  const env: Record<string, string> = {};
  if (url.password) env.PGPASSWORD = decodeURIComponent(url.password);
  const sslmode = url.searchParams.get('sslmode');
  if (sslmode) env.PGSSLMODE = sslmode;
  return { args, env };
}

/** Roda o pg_dump e grava em `file`. Se falha, a mensagem é só o que o pg_dump disse (sem a linha de comando). */
export function pgDump(databaseUrl: string, file: string): Promise<void> {
  const { args, env } = pgConnection(databaseUrl);
  return new Promise((resolve, reject) => {
    execFile(
      'pg_dump',
      ['--format=custom', '--no-owner', ...args, '--file', file],
      { env: { ...process.env, ...env }, timeout: DUMP_TIMEOUT_MS, windowsHide: true },
      (err, _stdout, stderr) => {
        if (!err) return resolve();
        const said = String(stderr).trim().slice(0, 600);
        const missing = (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'o programa pg_dump não está instalado' : '';
        reject(new Error(said || missing || 'o pg_dump falhou sem dizer por quê'));
      },
    );
  });
}

export interface BackupResult {
  file: string;
  bytes: number;
  /** Quantas cópias do banco ficaram guardadas. */
  kept: number;
  uploads: { copied: number; removed: number } | null;
}

export interface BackupDeps {
  /** Quem grava o dump em `file`; os testes trocam o pg_dump de verdade. */
  dump?: (databaseUrl: string, file: string) => Promise<void>;
  now?: () => number;
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** `coreto-AAAAMMDD-HHMMSS.dump`, em UTC: o nome ordena do mais antigo ao mais novo. */
export function dumpName(at: number): string {
  const d = new Date(at);
  const date = `${pad(d.getUTCFullYear(), 4)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
  const time = `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
  return `coreto-${date}-${time}.dump`;
}

/** Quando a cópia de um nome foi feita (UTC); `null` se o nome não é de uma cópia. */
export function dumpTime(name: string): number | null {
  const m = DUMP_NAME.exec(name);
  if (!m) return null;
  const [, date, time] = m as unknown as [string, string, string];
  const at = Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8), +time.slice(0, 2), +time.slice(2, 4), +time.slice(4, 6));
  return Number.isNaN(at) ? null : at;
}

async function listDumps(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((name) => DUMP_NAME.test(name)).sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

/** Quando foi a cópia mais recente do banco; `null` se não há nenhuma. */
export async function lastBackupAt(dir: string): Promise<number | null> {
  const last = (await listDumps(dir)).at(-1);
  return last ? dumpTime(last) : null;
}

/**
 * Copia para `dest` os anexos pequenos (até 8 MB) que ainda não estão lá e tira os que sumiram do servidor há mais de um
 * mês. Os grandes ficam de fora: copiá-los dobraria o espaço que os arquivos ocupam no disco.
 */
export async function mirrorUploads(src: string, dest: string, now: number): Promise<{ copied: number; removed: number }> {
  await mkdir(dest, { recursive: true });
  const live = new Set((await readdir(src).catch(() => [] as string[])).filter((name) => UUID.test(name)));
  const kept = new Set((await readdir(dest)).filter((name) => UUID.test(name)));

  let copied = 0;
  for (const name of live) {
    if (kept.has(name)) continue;
    const size = await stat(join(src, name)).then((s) => s.size, () => null);
    if (size === null || size > MIRROR_MAX_FILE_BYTES) continue;
    // Copia para um nome provisório e renomeia: uma imagem pela metade nunca parece completa.
    await copyFile(join(src, name), join(dest, `${name}.tmp`));
    await rename(join(dest, `${name}.tmp`), join(dest, name));
    copied++;
  }

  let removed = 0;
  for (const name of kept) {
    if (live.has(name)) continue;
    const { mtimeMs } = await stat(join(dest, name));
    if (now - mtimeMs < MIRROR_GRACE_MS) continue;
    await rm(join(dest, name), { force: true });
    removed++;
  }
  return { copied, removed };
}

/** Uma rodada: copia o banco, apaga as cópias antigas e atualiza o espelho das imagens. */
export async function runBackup(config: BackupConfig, deps: BackupDeps = {}): Promise<BackupResult> {
  const dump = deps.dump ?? pgDump;
  const now = deps.now ?? Date.now;
  await mkdir(config.dir, { recursive: true });

  const file = join(config.dir, dumpName(now()));
  // Grava num temporário e renomeia: uma cópia pela metade nunca parece completa.
  const partial = `${file}.tmp`;
  try {
    await dump(config.databaseUrl, partial);
    const { size } = await stat(partial);
    if (size === 0) throw new Error('o pg_dump gerou um arquivo vazio');
    await rename(partial, file);
  } catch (err) {
    await rm(partial, { force: true });
    throw err;
  }

  const all = await listDumps(config.dir);
  for (const old of all.slice(0, Math.max(0, all.length - config.keep))) await rm(join(config.dir, old), { force: true });
  // Um .tmp velho é de uma rodada interrompida (container reiniciado no meio) e não serve para nada.
  for (const name of await readdir(config.dir)) {
    if (!name.endsWith('.dump.tmp')) continue;
    const { mtimeMs } = await stat(join(config.dir, name));
    if (now() - mtimeMs > 60 * 60_000) await rm(join(config.dir, name), { force: true });
  }

  // Uma falha ao espelhar as imagens não desfaz a cópia do banco, que já está guardada.
  let uploads: BackupResult['uploads'] = null;
  if (config.uploadDir) uploads = await mirrorUploads(config.uploadDir, join(config.dir, UPLOADS_SUBDIR), now());

  return { file, bytes: (await stat(file)).size, kept: Math.min(all.length, config.keep), uploads };
}

/** A próxima hora cheia `hourUtc` (UTC) depois de `now`. */
export function nextRunAt(now: number, hourUtc: number): number {
  const d = new Date(now);
  const at = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hourUtc);
  return at > now ? at : at + DAY_MS;
}

export function describeResult(r: BackupResult): string {
  const mb = (r.bytes / 1024 / 1024).toFixed(r.bytes < 1024 * 1024 ? 2 : 1);
  const images = r.uploads ? `; imagens: ${r.uploads.copied} nova(s), ${r.uploads.removed} removida(s)` : '';
  return `${r.file} (${mb} MB), ${r.kept} cópia(s) guardada(s)${images}`;
}

export interface BackupJob {
  /** Faz uma rodada agora (se já há uma em andamento, espera por ela). */
  runNow(): Promise<BackupResult>;
  stop(): void;
}

export interface BackupLog {
  info(message: string): void;
  error(message: string): void;
}

/** Liga o backup diário. Ao subir, se a última cópia tem mais de um dia (ou não há), faz uma logo depois. */
export function startBackups(config: BackupConfig, log: BackupLog, deps: BackupDeps = {}): BackupJob {
  const now = deps.now ?? Date.now;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<BackupResult> | null = null;
  let stopped = false;

  const schedule = (at: number) => {
    if (stopped) return;
    timer = setTimeout(() => void tick(), Math.max(0, at - now()));
    timer.unref();
  };

  const runNow = (): Promise<BackupResult> => {
    running ??= runBackup(config, deps).finally(() => {
      running = null;
    });
    return running;
  };

  const tick = async () => {
    try {
      log.info(describeResult(await runNow()));
      schedule(nextRunAt(now(), config.hourUtc));
    } catch (err) {
      log.error(`falha: ${err instanceof Error ? err.message : String(err)}. Nova tentativa em 1 hora.`);
      schedule(now() + RETRY_MS);
    }
  };

  void lastBackupAt(config.dir)
    .catch(() => null)
    .then((last) => {
      const overdue = last === null || now() - last > DAY_MS;
      if (overdue) {
        log.info(last === null ? 'nenhuma cópia ainda; a primeira sai em instantes.' : 'a última cópia tem mais de um dia; uma nova sai em instantes.');
        schedule(now() + CATCH_UP_DELAY_MS);
      } else {
        schedule(nextRunAt(now(), config.hourUtc));
      }
    });

  return {
    runNow,
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}

import { mkdir, mkdtemp, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  backupConfigFromEnv,
  type BackupConfig,
  dumpName,
  dumpTime,
  lastBackupAt,
  mirrorUploads,
  nextRunAt,
  pgConnection,
  runBackup,
  startBackups,
} from '../../src/backup.js';

const UUID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const UUID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const UUID_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const DAY = 24 * 60 * 60_000;
const realSetTimeout = setTimeout;

describe('configuração', () => {
  it('fica desligada sem BACKUP_DIR, sem banco ou com BACKUP_AUTO=false', () => {
    expect(backupConfigFromEnv({ DATABASE_URL: 'postgresql://x/y' }, null)).toBeNull();
    expect(backupConfigFromEnv({ BACKUP_DIR: '/b' }, null)).toBeNull();
    expect(backupConfigFromEnv({ BACKUP_DIR: '/b', DATABASE_URL: 'postgresql://x/y', BACKUP_AUTO: 'False' }, null)).toBeNull();
  });

  it('usa 14 cópias às 06:00 UTC por padrão e ignora valores fora de faixa', () => {
    const base = { BACKUP_DIR: '/b', DATABASE_URL: 'postgresql://x/y' };
    expect(backupConfigFromEnv(base, '/up')).toEqual({ dir: '/b', keep: 14, hourUtc: 6, databaseUrl: 'postgresql://x/y', uploadDir: '/up' });
    expect(backupConfigFromEnv({ ...base, BACKUP_KEEP: '3', BACKUP_HOUR_UTC: '0' }, null)).toMatchObject({ keep: 3, hourUtc: 0 });
    expect(backupConfigFromEnv({ ...base, BACKUP_KEEP: '0', BACKUP_HOUR_UTC: '24' }, null)).toMatchObject({ keep: 14, hourUtc: 6 });
    expect(backupConfigFromEnv({ ...base, BACKUP_KEEP: 'muitas', BACKUP_HOUR_UTC: '' }, null)).toMatchObject({ keep: 14, hourUtc: 6 });
  });
});

describe('pgConnection', () => {
  it('separa os dados da URL e deixa a senha só no ambiente', () => {
    const { args, env } = pgConnection('postgresql://coreto:s%40nha%2Fx@db.interno:5433/meu%20banco?schema=public&sslmode=require');
    expect(args).toEqual(['--dbname', 'meu banco', '--host', 'db.interno', '--port', '5433', '--username', 'coreto']);
    expect(env).toEqual({ PGPASSWORD: 's@nha/x', PGSSLMODE: 'require' });
    expect(args.join(' ')).not.toContain('nha');
  });

  it('aceita URL sem porta, usuário e senha', () => {
    expect(pgConnection('postgresql://localhost/coreto')).toEqual({ args: ['--dbname', 'coreto', '--host', 'localhost'], env: {} });
  });
});

describe('nomes e horários', () => {
  it('o nome da cópia tem a data em UTC e volta para o mesmo instante', () => {
    const at = Date.UTC(2026, 9, 22, 6, 0, 5);
    expect(dumpName(at)).toBe('coreto-20261022-060005.dump');
    expect(dumpTime('coreto-20261022-060005.dump')).toBe(at);
    expect(dumpTime('coreto-20261022-060005.dump.tmp')).toBeNull();
    expect(dumpTime('outra-coisa.dump')).toBeNull();
  });

  it('a próxima rodada é a próxima hora marcada, hoje ou amanhã', () => {
    const noon = Date.UTC(2026, 9, 22, 12, 0, 0);
    expect(nextRunAt(noon, 6)).toBe(Date.UTC(2026, 9, 23, 6));
    expect(nextRunAt(noon, 18)).toBe(Date.UTC(2026, 9, 22, 18));
    expect(nextRunAt(Date.UTC(2026, 9, 22, 6), 6)).toBe(Date.UTC(2026, 9, 23, 6)); // já passou da hora exata
    expect(nextRunAt(Date.UTC(2026, 11, 31, 23), 6)).toBe(Date.UTC(2027, 0, 1, 6));
  });
});

describe('rodada de backup', () => {
  let root: string;
  let config: BackupConfig;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'coreto-backup-'));
    await mkdir(join(root, 'up'));
    config = { dir: join(root, 'backups'), keep: 3, hourUtc: 6, databaseUrl: 'postgresql://x/y', uploadDir: null };
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  const fakeDump = (content = 'dados') => vi.fn(async (_url: string, file: string) => writeFile(file, content));
  const at = (day: number) => () => Date.UTC(2026, 9, day, 6);
  const files = async () => (await readdir(config.dir)).filter((n) => n.startsWith('coreto-')).sort();

  it('grava a cópia com o nome da hora e só entrega a URL ao pg_dump', async () => {
    const dump = fakeDump();
    const result = await runBackup(config, { dump, now: at(22) });
    expect(dump).toHaveBeenCalledWith('postgresql://x/y', join(config.dir, 'coreto-20261022-060000.dump.tmp'));
    expect(result).toMatchObject({ file: join(config.dir, 'coreto-20261022-060000.dump'), bytes: 5, kept: 1, uploads: null });
    expect(await files()).toEqual(['coreto-20261022-060000.dump']);
  });

  it('guarda só as mais recentes', async () => {
    for (const day of [1, 2, 3, 4, 5]) await runBackup(config, { dump: fakeDump(), now: at(day) });
    expect(await files()).toEqual(['coreto-20261003-060000.dump', 'coreto-20261004-060000.dump', 'coreto-20261005-060000.dump']);
    expect(await lastBackupAt(config.dir)).toBe(Date.UTC(2026, 9, 5, 6));
  });

  it('uma falha não deixa cópia pela metade nem apaga as cópias boas', async () => {
    await runBackup(config, { dump: fakeDump(), now: at(1) });
    const broken = vi.fn(async (_url: string, file: string) => {
      await writeFile(file, 'pela metade');
      throw new Error('conexão recusada');
    });
    await expect(runBackup(config, { dump: broken, now: at(2) })).rejects.toThrow('conexão recusada');
    expect(await readdir(config.dir)).toEqual(['coreto-20261001-060000.dump']);
  });

  it('recusa uma cópia vazia', async () => {
    await expect(runBackup(config, { dump: fakeDump(''), now: at(1) })).rejects.toThrow(/vazio/);
    expect(await readdir(config.dir)).toEqual([]);
  });

  it('apaga o .tmp antigo de uma rodada interrompida, mas não o recente', async () => {
    await mkdir(config.dir);
    const stale = join(config.dir, 'coreto-20260101-060000.dump.tmp');
    const fresh = join(config.dir, 'coreto-20261022-050000.dump.tmp');
    await writeFile(stale, 'x');
    await writeFile(fresh, 'x');
    const old = new Date(Date.now() - 3 * 60 * 60_000);
    await utimes(stale, old, old);
    await runBackup(config, { dump: fakeDump() });
    expect(await readdir(config.dir)).not.toContain('coreto-20260101-060000.dump.tmp');
    expect(await readdir(config.dir)).toContain('coreto-20261022-050000.dump.tmp');
  });

  it('não espelha anexo grande (dobraria o espaço do disco), só os pequenos', async () => {
    const withUploads = { ...config, uploadDir: join(root, 'up') };
    await writeFile(join(root, 'up', UUID_A), 'pequeno');
    await writeFile(join(root, 'up', UUID_B), Buffer.alloc(9 * 1024 * 1024, 1));
    const result = await runBackup(withUploads, { dump: fakeDump(), now: at(1) });
    expect(result.uploads).toEqual({ copied: 1, removed: 0 });
    expect(await readdir(join(config.dir, 'uploads'))).toEqual([UUID_A]);
  });

  it('espelha as imagens junto: copia as novas e ignora o que não é imagem enviada', async () => {
    const withUploads = { ...config, uploadDir: join(root, 'up') };
    await writeFile(join(root, 'up', UUID_A), 'a');
    await writeFile(join(root, 'up', 'leia-me.txt'), 'x');
    const first = await runBackup(withUploads, { dump: fakeDump(), now: at(1) });
    expect(first.uploads).toEqual({ copied: 1, removed: 0 });
    await writeFile(join(root, 'up', UUID_B), 'b');
    const second = await runBackup(withUploads, { dump: fakeDump(), now: at(2) });
    expect(second.uploads).toEqual({ copied: 1, removed: 0 });
    expect((await readdir(join(config.dir, 'uploads'))).sort()).toEqual([UUID_A, UUID_B]);
  });
});

describe('mirrorUploads', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'coreto-mirror-'));
    await mkdir(join(root, 'src'));
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it('só tira do espelho o que sumiu do servidor há mais de um mês', async () => {
    const src = join(root, 'src');
    const dest = join(root, 'dest');
    await mkdir(dest);
    await writeFile(join(src, UUID_A), 'a');
    await writeFile(join(dest, UUID_B), 'b'); // sumiu do servidor agora
    await writeFile(join(dest, UUID_C), 'c'); // sumiu há 40 dias
    const old = new Date(Date.now() - 40 * DAY);
    await utimes(join(dest, UUID_C), old, old);

    expect(await mirrorUploads(src, dest, Date.now())).toEqual({ copied: 1, removed: 1 });
    expect((await readdir(dest)).sort()).toEqual([UUID_A, UUID_B]);
  });

  it('copia mesmo quando a pasta de imagens ainda não existe', async () => {
    expect(await mirrorUploads(join(root, 'nao-existe'), join(root, 'dest'), Date.now())).toEqual({ copied: 0, removed: 0 });
    expect((await stat(join(root, 'dest'))).isDirectory()).toBe(true);
  });
});

describe('agendamento', () => {
  // Os temporizadores são falsos, mas o disco é de verdade: depois de cada avanço, dá um instante ao disco para responder.
  const settle = () => new Promise<void>((resolve) => realSetTimeout(resolve, 40));
  const advance = async (ms: number) => {
    await vi.advanceTimersByTimeAsync(ms);
    await settle();
  };
  let dir: string;
  let config: BackupConfig;
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(Date.UTC(2026, 9, 22, 12, 0, 0));
    dir = await mkdtemp(join(tmpdir(), 'coreto-schedule-'));
    config = { dir, keep: 5, hourUtc: 6, databaseUrl: 'postgresql://x/y', uploadDir: null };
  });
  afterEach(async () => {
    vi.useRealTimers();
    await rm(dir, { recursive: true, force: true });
  });

  const log = () => ({ info: vi.fn(), error: vi.fn() });
  const dump = (fail = false) =>
    vi.fn(async (_url: string, file: string) => {
      if (fail) throw new Error('banco fora do ar');
      await writeFile(file, 'dados');
    });

  it('sem nenhuma cópia, faz a primeira logo depois de subir e a próxima na hora marcada', async () => {
    const run = dump();
    const out = log();
    const job = startBackups(config, out, { dump: run });
    await settle();
    await advance(60_000);
    expect(run).not.toHaveBeenCalled(); // espera o servidor assentar
    await advance(2 * 60_000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(out.info).toHaveBeenCalledWith(expect.stringContaining('coreto-20261022-120'));

    // Amanhã às 06:00 UTC, e não 24 horas depois da primeira.
    await advance(Date.UTC(2026, 9, 23, 5, 59, 0) - Date.now());
    expect(run).toHaveBeenCalledTimes(1);
    await advance(2 * 60_000);
    expect(run).toHaveBeenCalledTimes(2);
    job.stop();
  });

  it('com uma cópia de hoje cedo, não copia de novo ao subir (um deploy não gera cópia à toa)', async () => {
    await writeFile(join(dir, dumpName(Date.UTC(2026, 9, 22, 6, 0, 0))), 'dados');
    const run = dump();
    const job = startBackups(config, log(), { dump: run });
    await settle();
    await advance(10 * 60_000);
    expect(run).not.toHaveBeenCalled();
    await advance(Date.UTC(2026, 9, 23, 6, 1, 0) - Date.now());
    expect(run).toHaveBeenCalledTimes(1);
    job.stop();
  });

  it('com a última cópia velha, faz uma ao subir', async () => {
    await writeFile(join(dir, dumpName(Date.UTC(2026, 9, 19, 6, 0, 0))), 'dados');
    const run = dump();
    const job = startBackups(config, log(), { dump: run });
    await settle();
    await advance(3 * 60_000);
    expect(run).toHaveBeenCalledTimes(1);
    job.stop();
  });

  it('se falha, avisa e tenta de novo em uma hora', async () => {
    const run = dump(true);
    const out = log();
    const job = startBackups(config, out, { dump: run });
    await settle();
    await advance(3 * 60_000);
    expect(out.error).toHaveBeenCalledWith(expect.stringContaining('banco fora do ar'));
    expect(run).toHaveBeenCalledTimes(1);
    await advance(61 * 60_000);
    expect(run).toHaveBeenCalledTimes(2);
    job.stop();
  });

  it('não roda duas ao mesmo tempo e para quando mandam parar', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const run = vi.fn(async (_url: string, file: string) => {
      await gate;
      await writeFile(file, 'dados');
    });
    const job = startBackups(config, log(), { dump: run });
    await settle();
    await advance(3 * 60_000); // a rodada automática começa e fica esperando
    const manual = job.runNow();
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await manual;

    job.stop();
    await advance(3 * DAY);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

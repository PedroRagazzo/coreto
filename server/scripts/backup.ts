// Faz uma cópia do banco agora (a mesma rodada que o servidor faz sozinho todo dia).
//
//   npm run backup -w server
//
//   DATABASE_URL  o banco (obrigatória)
//   BACKUP_DIR    pasta das cópias (padrão: /data/backups, um volume no Dokploy)
//   BACKUP_KEEP   quantas cópias do banco guardar (padrão: 14)
//   UPLOAD_DIR    pasta das imagens enviadas, espelhadas junto (padrão: a mesma do servidor)
//
// Restaurar (apaga e recria as tabelas a partir da cópia; veja "Backup do banco" no README):
//   pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" /data/backups/coreto-AAAAMMDD-HHMMSS.dump

import 'dotenv/config';
import { resolve } from 'node:path';
import { backupConfigFromEnv, describeResult, runBackup } from '../src/backup.js';

const config = backupConfigFromEnv(
  { ...process.env, BACKUP_DIR: process.env.BACKUP_DIR ?? '/data/backups', BACKUP_AUTO: 'true' },
  resolve(process.env.UPLOAD_DIR ?? 'uploads'),
);
if (!config) {
  console.error('backup: DATABASE_URL não definida.');
  process.exit(1);
}

runBackup(config).then(
  (result) => console.log(`backup: ${describeResult(result)}`),
  (err: unknown) => {
    console.error(`backup: falhou: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  },
);

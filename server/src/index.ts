import 'dotenv/config';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { startServer } from './app.js';
import { createDb } from './db/client.js';
import { createMusic, musicConfigFromEnv } from './music/index.js';
import { seedIfEmpty } from './seed.js';
import { Store } from './store.js';
import { sweepUploads, UploadDir } from './uploads.js';

// SERVER_PORT, e não PORT: ferramentas de dev costumam definir PORT para o front-end.
const PORT = Number(process.env.SERVER_PORT ?? 3001);
const CLIENT_ORIGINS = (process.env.CLIENT_ORIGIN ?? 'http://localhost:5173,http://127.0.0.1:5173').split(',');
/** Pasta das imagens enviadas; relativa à pasta server/. */
const UPLOAD_DIR = resolve(process.env.UPLOAD_DIR ?? 'uploads');
const SWEEP_INTERVAL_MS = 60 * 60_000;
/** Build do site; em produção o servidor entrega site e API no mesmo endereço. */
const CLIENT_DIST = resolve(process.env.CLIENT_DIST ?? '../client/dist');

main().catch((err: unknown) => {
  console.error('Coreto: falha ao iniciar o servidor.', err);
  process.exit(1);
});

async function main() {
  const db = createDb();
  if (await seedIfEmpty(db)) console.log('Coreto: banco vazio, dados de demonstração criados.');
  const store = await Store.load(db);
  // Administradores gerais: nomes de contas já existentes, separados por vírgula.
  const superAdmins = (process.env.SUPER_ADMIN_NAMES ?? '').split(',').map((n) => n.trim()).filter(Boolean);
  store.setSuperAdmins(superAdmins);
  if (superAdmins.length) console.log(`Coreto: ${superAdmins.length} administrador(es) geral(is) configurado(s).`);
  const clientDist = existsSync(resolve(CLIENT_DIST, 'index.html')) ? CLIENT_DIST : null;
  const server = await startServer(store, {
    port: PORT,
    clientOrigins: CLIENT_ORIGINS,
    uploadDir: UPLOAD_DIR,
    clientDist,
    music: createMusic(musicConfigFromEnv()),
  });
  console.log(`Coreto: servidor em tempo real em http://localhost:${server.port}`);
  if (clientDist) console.log(`Coreto: site servido de ${clientDist}`);

  // Limpa anexos nunca usados e arquivos de canais e espaços excluídos.
  const uploads = new UploadDir(UPLOAD_DIR);
  const sweep = () =>
    sweepUploads(db, uploads).catch((err: unknown) => console.error('[uploads] falha na limpeza', err));
  void sweep();
  const sweeper = setInterval(sweep, SWEEP_INTERVAL_MS);
  sweeper.unref();

  const shutdown = async () => {
    clearInterval(sweeper);
    await server.close();
    await db.$disconnect();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

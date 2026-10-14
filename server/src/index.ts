import 'dotenv/config';
import { startServer } from './app.js';
import { createDb } from './db/client.js';
import { seedIfEmpty } from './seed.js';
import { Store } from './store.js';

// SERVER_PORT, e não PORT: ferramentas de dev costumam definir PORT para o front-end.
const PORT = Number(process.env.SERVER_PORT ?? 3001);
const CLIENT_ORIGINS = (process.env.CLIENT_ORIGIN ?? 'http://localhost:5173,http://127.0.0.1:5173').split(',');

main().catch((err: unknown) => {
  console.error('Coreto: falha ao iniciar o servidor.', err);
  process.exit(1);
});

async function main() {
  const db = createDb();
  if (await seedIfEmpty(db)) console.log('Coreto: banco vazio, dados de demonstração criados.');
  const store = await Store.load(db);
  const server = await startServer(store, { port: PORT, clientOrigins: CLIENT_ORIGINS });
  console.log(`Coreto: servidor em tempo real em http://localhost:${server.port}`);

  const shutdown = async () => {
    await server.close();
    await db.$disconnect();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

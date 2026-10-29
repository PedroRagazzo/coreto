// Sobe o Coreto de verdade para os testes do site: o servidor real, o site já compilado (client/dist) na mesma origem e
// um banco de teste zerado, com os dados de demonstração. Quem chama é o `webServer` do Playwright (playwright.config.ts).

import { execSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../server/src/app.js';
import { createDb } from '../server/src/db/client.js';
import { seedIfEmpty } from '../server/src/seed.js';
import { Store } from '../server/src/store.js';
import { iceConfigFromEnv } from '../server/src/turn.js';
import { assertTestDatabase } from '../server/test/support/database.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.TEST_DATABASE_URL;
const port = Number(process.env.E2E_PORT ?? 3100);

if (!url) {
  console.error('TEST_DATABASE_URL não definida. Veja "Testes do site" no README.');
  process.exit(1);
}
// Os testes apagam o banco: nunca contra um que não seja de teste.
assertTestDatabase(url);

execSync('npx prisma migrate deploy', { cwd: join(root, 'server'), stdio: 'pipe', env: { ...process.env, DATABASE_URL: url } });

const db = createDb(url);
const tables = await db.$queryRaw<{ tablename: string }[]>`
  SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
if (tables.length > 0) await db.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
await seedIfEmpty(db);

const server = await startServer(await Store.load(db), {
  port,
  clientOrigins: [],
  uploadDir: await mkdtemp(join(tmpdir(), 'coreto-e2e-uploads-')),
  clientDist: join(root, 'client', 'dist'),
  ice: iceConfigFromEnv({}),
  // Sem servidor de mídia: a tela vai pela malha P2P, como numa instalação sem LiveKit.
  sfu: null,
  // Nenhum teste visita a internet: a pré-visualização de links responde sempre "nada para mostrar".
  embeds: { preview: async () => null, image: async () => null },
});
console.log(`Coreto (testes do site) em http://localhost:${server.port}`);

const stop = () => void server.close().then(() => db.$disconnect()).finally(() => process.exit(0));
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

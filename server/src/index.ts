import 'dotenv/config';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { createDb } from './db/client.js';
import { registerChat } from './realtime/chat.js';
import { registerDirect } from './realtime/direct.js';
import { registerManagement } from './realtime/manage.js';
import { joinPublicSpaces } from './realtime/membership.js';
import { registerPresence } from './realtime/presence.js';
import type { IO } from './realtime/types.js';
import { registerVoice } from './realtime/voice.js';
import { seedIfEmpty } from './seed.js';
import { Store } from './store.js';

// SERVER_PORT, e não PORT: ferramentas de dev costumam definir PORT para o front-end.
const PORT = Number(process.env.SERVER_PORT ?? 3001);
const CLIENT_ORIGINS = (process.env.CLIENT_ORIGIN ?? 'http://localhost:5173,http://127.0.0.1:5173').split(',');
const MAX_DISPLAY_NAME = 32;

main().catch((err: unknown) => {
  console.error('Coreto: falha ao iniciar o servidor.', err);
  process.exit(1);
});

async function main() {
  const db = createDb();
  if (await seedIfEmpty(db)) console.log('Coreto: banco vazio, dados de demonstração criados.');
  const store = await Store.load(db);
  const io = startRealtime(store);

  const shutdown = async () => {
    await io.close();
    await db.$disconnect();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

function startRealtime(store: Store): IO {
  const httpServer = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(404).end();
  });

  const io: IO = new Server(httpServer, { cors: { origin: CLIENT_ORIGINS } });

  // Autentica e garante a participação nos espaços antes de liberar a conexão.
  io.use((socket, next) => {
    const { token, displayName } = (socket.handshake.auth ?? {}) as Record<string, unknown>;
    const name = typeof displayName === 'string' ? displayName.trim().slice(0, MAX_DISPLAY_NAME) : '';
    if (typeof token !== 'string' || token.length < 16 || !name) {
      return next(new Error('Identificação inválida.'));
    }
    store
      .resolveSession(token, name)
      .then(async (user) => {
        socket.data.userId = user.id;
        await joinPublicSpaces(io, store, user.id);
        next();
      })
      .catch((err: unknown) => {
        console.error('[auth]', err);
        next(new Error('Não foi possível entrar agora. Tente de novo.'));
      });
  });

  io.on('connection', (socket) => {
    registerPresence(io, socket, store);
    registerChat(io, socket, store);
    registerDirect(socket, store);
    registerManagement(io, socket, store);
    registerVoice(io, socket, store);
  });

  httpServer.listen(PORT, () => {
    console.log(`Coreto: servidor em tempo real em http://localhost:${PORT}`);
  });
  return io;
}

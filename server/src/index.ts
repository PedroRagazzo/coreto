import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { registerChat } from './realtime/chat.js';
import { registerDirect } from './realtime/direct.js';
import { joinPublicSpaces } from './realtime/membership.js';
import { registerPresence } from './realtime/presence.js';
import type { IO } from './realtime/types.js';
import { registerVoice } from './realtime/voice.js';
import { seed } from './seed.js';
import { Store } from './store.js';

// SERVER_PORT, e não PORT: ferramentas de dev costumam definir PORT para o front-end.
const PORT = Number(process.env.SERVER_PORT ?? 3001);
const CLIENT_ORIGINS = (process.env.CLIENT_ORIGIN ?? 'http://localhost:5173,http://127.0.0.1:5173').split(',');
const MAX_DISPLAY_NAME = 32;

const store = new Store();
seed(store);

const httpServer = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true }));
    return;
  }
  res.writeHead(404).end();
});

const io: IO = new Server(httpServer, { cors: { origin: CLIENT_ORIGINS } });

io.use((socket, next) => {
  const { token, displayName } = (socket.handshake.auth ?? {}) as Record<string, unknown>;
  const name = typeof displayName === 'string' ? displayName.trim().slice(0, MAX_DISPLAY_NAME) : '';
  if (typeof token !== 'string' || token.length < 16 || !name) {
    return next(new Error('Identificação inválida.'));
  }
  socket.data.userId = store.resolveSession(token, name).id;
  next();
});

io.on('connection', (socket) => {
  joinPublicSpaces(io, store, socket.data.userId);
  registerPresence(io, socket, store);
  registerChat(io, socket, store);
  registerDirect(socket, store);
  registerVoice(io, socket, store);
});

httpServer.listen(PORT, () => {
  console.log(`Coreto: servidor em tempo real em http://localhost:${PORT}`);
});

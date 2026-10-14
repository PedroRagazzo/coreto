import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from 'socket.io';
import { registerChat } from './realtime/chat.js';
import { registerDirect } from './realtime/direct.js';
import { registerManagement } from './realtime/manage.js';
import { joinPublicSpaces } from './realtime/membership.js';
import { registerPresence } from './realtime/presence.js';
import type { IO } from './realtime/types.js';
import { registerVoice } from './realtime/voice.js';
import type { Store } from './store.js';

const MAX_DISPLAY_NAME = 32;

export interface ServerOptions {
  /** 0 escolhe uma porta livre (usado nos testes). */
  port: number;
  clientOrigins: string[];
}

export interface RunningServer {
  io: IO;
  /** Porta em que o servidor realmente está ouvindo. */
  port: number;
  close(): Promise<void>;
}

/** Sobe o HTTP + socket.io sobre um Store já carregado. */
export async function startServer(store: Store, { port, clientOrigins }: ServerOptions): Promise<RunningServer> {
  const httpServer = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(404).end();
  });

  const io: IO = new Server(httpServer, { cors: { origin: clientOrigins } });

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

  await new Promise<void>((resolve) => httpServer.listen(port, resolve));
  return {
    io,
    port: (httpServer.address() as AddressInfo).port,
    // io.close() também fecha o servidor HTTP.
    close: () => io.close(),
  };
}

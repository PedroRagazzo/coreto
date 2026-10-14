import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from 'socket.io';
import { isValidPin, loginKey, normalizeDisplayName } from '../../shared/src/names.js';
import { INVALID_SESSION, type LoginRequest, type LoginResponse } from '../../shared/src/protocol.js';
import { LoginThrottle } from './auth.js';
import { registerChat } from './realtime/chat.js';
import { registerDirect } from './realtime/direct.js';
import { registerManagement } from './realtime/manage.js';
import { joinPublicSpaces } from './realtime/membership.js';
import { registerPresence } from './realtime/presence.js';
import type { IO } from './realtime/types.js';
import { registerVoice } from './realtime/voice.js';
import type { Store } from './store.js';

const MAX_BODY_BYTES = 2_048;

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

/** Sobe o HTTP (saúde e login) + socket.io sobre um Store já carregado. */
export async function startServer(store: Store, { port, clientOrigins }: ServerOptions): Promise<RunningServer> {
  const throttle = new LoginThrottle();

  const httpServer = createServer((req, res) => {
    if (req.url === '/health') return sendJson(res, 200, { ok: true });
    if (req.url === '/login') return void handleLogin(req, res, store, throttle, clientOrigins);
    res.writeHead(404).end();
  });

  const io: IO = new Server(httpServer, { cors: { origin: clientOrigins } });

  // Só entra quem tem um token de sessão válido (obtido em POST /login).
  io.use((socket, next) => {
    const { token } = (socket.handshake.auth ?? {}) as Record<string, unknown>;
    const invalid = () => next(Object.assign(new Error('Sessão inválida. Entre de novo.'), { data: { code: INVALID_SESSION } }));
    if (typeof token !== 'string' || token.length < 16) return invalid();
    store
      .userForSession(token)
      .then(async (user) => {
        if (!user) return invalid();
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

async function handleLogin(
  req: IncomingMessage,
  res: ServerResponse,
  store: Store,
  throttle: LoginThrottle,
  clientOrigins: string[],
): Promise<void> {
  // O front-end roda em outra origem (porta 5173): libera só as origens configuradas.
  const origin = req.headers.origin;
  if (origin && clientOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'content-type' }).end();
    return;
  }
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, code: 'invalid_input', error: 'Use POST.' });

  let body: Partial<LoginRequest>;
  try {
    body = (await readJson(req)) as Partial<LoginRequest>;
  } catch {
    return sendJson(res, 400, { ok: false, code: 'invalid_input', error: 'Pedido inválido.' });
  }

  const name = typeof body.name === 'string' ? normalizeDisplayName(body.name) : '';
  const pin = typeof body.pin === 'string' ? body.pin : '';
  if (!name) return sendLogin(res, 400, { ok: false, code: 'invalid_input', error: 'Digite um nome.' });
  if (!isValidPin(pin)) {
    return sendLogin(res, 400, { ok: false, code: 'invalid_input', error: 'O PIN tem exatamente 4 números.' });
  }

  const key = loginKey(name);
  const lockedMs = throttle.remainingLock(key);
  if (lockedMs > 0) {
    const seconds = Math.ceil(lockedMs / 1000);
    return sendLogin(res, 429, {
      ok: false,
      code: 'locked',
      error: `Muitas tentativas erradas. Tente de novo em ${seconds} s.`,
    });
  }

  try {
    const result = await store.login(name, pin);
    if (result.status === 'reserved_name') {
      return sendLogin(res, 403, { ok: false, code: 'reserved_name', error: 'Esse nome é reservado. Escolha outro.' });
    }
    if (result.status === 'wrong_pin') {
      throttle.recordFailure(key);
      return sendLogin(res, 401, { ok: false, code: 'wrong_pin', error: 'PIN incorreto para esse nome.' });
    }
    throttle.recordSuccess(key);
    sendLogin(res, 200, { ok: true, token: result.token, user: result.user, created: result.created });
  } catch (err) {
    console.error('[login]', err);
    sendJson(res, 500, { ok: false, error: 'Não foi possível entrar agora. Tente de novo.' });
  }
}

const sendLogin = (res: ServerResponse, status: number, body: LoginResponse) => sendJson(res, status, body);

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Corpo grande demais.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}


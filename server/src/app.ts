import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from 'socket.io';
import { isValidPin, loginKey, normalizeDisplayName } from '../../shared/src/names.js';
import { INVALID_SESSION, type LoginRequest, type LoginResponse } from '../../shared/src/protocol.js';
import { LoginThrottle } from './auth.js';
import { LatestInstaller } from './download.js';
import type { MusicBot, MusicFactory } from './music/index.js';
import { registerMusic } from './music/socket.js';
import { registerChat } from './realtime/chat.js';
import { registerDirect } from './realtime/direct.js';
import { registerManagement } from './realtime/manage.js';
import { joinPublicSpaces } from './realtime/membership.js';
import { registerPresence } from './realtime/presence.js';
import type { IO } from './realtime/types.js';
import { registerVoice } from './realtime/voice.js';
import { sfuConfigFromEnv, type SfuConfig } from './sfu.js';
import type { Store } from './store.js';
import { serveClient } from './static.js';
import { iceConfigFromEnv, type IceConfig } from './turn.js';
import { handleUpload, readBody, serveUpload, UploadDir } from './uploads.js';

const MAX_BODY_BYTES = 2_048;

export interface ServerOptions {
  /** 0 escolhe uma porta livre (usado nos testes). */
  port: number;
  clientOrigins: string[];
  /** Pasta dos anexos; é criada se não existir. */
  uploadDir: string;
  /** Padrão: lido das variáveis de ambiente (ver turn.ts). */
  ice?: IceConfig;
  /** Servidor de mídia das transmissões de tela (ver sfu.ts); `null` = só P2P. Padrão: lido do ambiente. */
  sfu?: SfuConfig | null;
  /** Build do client (client/dist) para servir o site na mesma origem; sem ele, só a API. */
  clientDist?: string | null;
  /** Cria o bot de música (ver music/index.ts); sem ele, os comandos de música não existem. */
  music?: MusicFactory;
}

export interface RunningServer {
  io: IO;
  /** Porta em que o servidor realmente está ouvindo. */
  port: number;
  close(): Promise<void>;
}

/** Sobe o HTTP (saúde, login e anexos) + socket.io sobre um Store já carregado. */
export async function startServer(
  store: Store,
  { port, clientOrigins, uploadDir, ice = iceConfigFromEnv(), sfu = sfuConfigFromEnv(), clientDist = null, music: createMusic }: ServerOptions,
): Promise<RunningServer> {
  const throttle = new LoginThrottle();
  const uploads = new UploadDir(uploadDir);
  await uploads.ensure();
  const installer = new LatestInstaller();
  // O site precisa poder falar com o servidor de mídia (ws → http, wss → https).
  const connectOrigins = sfu ? [new URL(sfu.url.replace(/^ws/, 'http')).origin] : [];

  const httpServer = createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0];
    if (path === '/health') return sendJson(res, 200, { ok: true });
    if (path === '/download' && (req.method === 'GET' || req.method === 'HEAD')) {
      return void installer.get().then((url) => res.writeHead(302, { location: url, 'cache-control': 'no-store' }).end());
    }
    if (path === '/login') {
      if (preflight(req, res, clientOrigins, 'POST', 'content-type')) return;
      return void handleLogin(req, res, store, throttle);
    }
    if (path === '/uploads') {
      if (preflight(req, res, clientOrigins, 'POST', 'authorization, content-type, x-file-name')) return;
      return void handleUpload(req, res, store, uploads).catch((err: unknown) => {
        console.error('[upload]', err);
        if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'Não foi possível guardar a imagem.' });
      });
    }
    const file = /^\/uploads\/([^/]+)$/.exec(path);
    if (file && req.method === 'GET') {
      return void serveUpload(file[1], res, store, uploads).catch((err: unknown) => {
        console.error('[upload]', err);
        if (!res.headersSent) res.writeHead(500).end();
      });
    }
    if (clientDist) {
      return void serveClient(req, res, clientDist, connectOrigins).catch((err: unknown) => {
        console.error('[site]', err);
        if (!res.headersSent) res.writeHead(500).end();
      });
    }
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

  let music: MusicBot | null = null;
  io.on('connection', (socket) => {
    registerPresence(io, socket, store);
    registerChat(io, socket, store, uploads, (message, channel) => music?.onMessage(message, channel));
    registerDirect(socket, store);
    registerManagement(io, socket, store);
    registerVoice(io, socket, store, ice, sfu);
    registerMusic(socket, () => music);
  });

  music = (await createMusic?.({ io, store, ice })) ?? null;
  if (music) store.voiceObservers.add(music);

  await new Promise<void>((resolve) => httpServer.listen(port, resolve));
  return {
    io,
    port: (httpServer.address() as AddressInfo).port,
    // io.close() também fecha o servidor HTTP.
    close: () => {
      if (music) {
        store.voiceObservers.delete(music);
        music.shutdown();
      }
      return io.close();
    },
  };
}

/**
 * O front-end roda em outra origem (porta 5173): libera só as origens
 * configuradas. Devolve `true` se já respondeu (pedido OPTIONS de pré-voo).
 */
function preflight(req: IncomingMessage, res: ServerResponse, clientOrigins: string[], methods: string, headers: string): boolean {
  const origin = req.headers.origin;
  if (origin && clientOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  if (req.method !== 'OPTIONS') return false;
  res.writeHead(204, { 'Access-Control-Allow-Methods': methods, 'Access-Control-Allow-Headers': headers }).end();
  return true;
}

async function handleLogin(req: IncomingMessage, res: ServerResponse, store: Store, throttle: LoginThrottle): Promise<void> {
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

async function readJson(req: IncomingMessage): Promise<unknown> {
  const body = await readBody(req, MAX_BODY_BYTES);
  if (!body) throw new Error('Corpo grande demais.');
  return JSON.parse(body.toString('utf8'));
}

// Sobe o servidor real numa porta livre contra o banco de teste e conecta
// clientes socket.io como se fossem navegadores.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io as connectSocket, type Socket } from 'socket.io-client';
import type { Channel, DirectConversation, MentionCount, Space, SpaceSnapshot, UnreadCount, User } from '../../../shared/src/models.js';
import type {
  Ack,
  ClientToServerEvents,
  LoginResponse,
  ServerToClientEvents,
  UploadResponse,
} from '../../../shared/src/protocol.js';
import { startServer, type RunningServer } from '../../src/app.js';
import type { MusicFactory } from '../../src/music/index.js';
import { BOT_SOCKET_ID } from '../../src/music/bot.js';
import { createDb, type Db } from '../../src/db/client.js';
import { seedIfEmpty } from '../../src/seed.js';
import type { SfuConfig } from '../../src/sfu.js';
import { Store } from '../../src/store.js';
import { iceConfigFromEnv } from '../../src/turn.js';
import { assertTestDatabase, TEST_DATABASE_URL } from './database.js';

export type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** PIN de todas as contas criadas por `connect`. */
export const DEFAULT_PIN = '1234';
let accountCounter = 0;

export interface TestClient {
  socket: TestSocket;
  token: string;
  user: User;
  spaces: Space[];
  directs: DirectConversation[];
  directUsers: User[];
  mentions: MentionCount[];
  unread: UnreadCount[];
}

type EventName = keyof ServerToClientEvents;
type EventPayload<E extends EventName> = Parameters<ServerToClientEvents[E]>[0];

export class TestServer {
  private server: RunningServer | null = null;
  private store: Store | null = null;
  private readonly clients: TestSocket[] = [];

  private constructor(
    readonly db: Db,
    /** Pasta temporária dos anexos, apagada em `stop`. */
    readonly uploadDir: string,
    /** Bot de música, só nos testes que o usam. */
    private readonly music?: MusicFactory,
    /** Servidor de mídia das transmissões, só nos testes dele. */
    private readonly sfu: SfuConfig | null = null,
  ) {}

  /** Apaga o banco de teste, recria os dados de demonstração e sobe o servidor. */
  static async start(options: { music?: MusicFactory; sfu?: SfuConfig } = {}): Promise<TestServer> {
    if (!TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL não definida.');
    assertTestDatabase(TEST_DATABASE_URL);
    const db = createDb(TEST_DATABASE_URL);
    await resetDatabase(db);
    await seedIfEmpty(db);
    const harness = new TestServer(db, await mkdtemp(join(tmpdir(), 'coreto-uploads-')), options.music, options.sfu ?? null);
    await harness.boot();
    return harness;
  }

  get url(): string {
    if (!this.server) throw new Error('Servidor parado.');
    return `http://localhost:${this.server.port}`;
  }

  /** Simula um reinício: derruba tudo e recarrega o estado só a partir do banco. */
  async restart(): Promise<void> {
    await this.disconnectAll();
    await this.server?.close();
    await this.boot();
  }

  async stop(): Promise<void> {
    await this.disconnectAll();
    await this.server?.close();
    await this.db.$disconnect();
    await rm(this.uploadDir, { recursive: true, force: true });
  }

  /** Torna a conta (pelo nome) administradora geral, como SUPER_ADMIN_NAMES faz no servidor. */
  makeSuperAdmin(...names: string[]): void {
    this.store?.setSuperAdmins(names);
  }

  /** POST /login cru, para testar as respostas do servidor. */
  async login(name: string, pin: string): Promise<{ status: number; body: LoginResponse }> {
    const res = await fetch(`${this.url}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, pin }),
    });
    return { status: res.status, body: (await res.json()) as LoginResponse };
  }

  /** POST /uploads com o token da pessoa (ou um token qualquer). */
  async upload(token: string, data: Buffer, fileName = 'foto.png'): Promise<{ status: number; body: UploadResponse }> {
    const res = await fetch(`${this.url}/uploads`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'x-file-name': encodeURIComponent(fileName) },
      body: data,
    });
    return { status: res.status, body: (await res.json()) as UploadResponse };
  }

  /**
   * Cria uma conta nova e conecta. Cada chamada gera um nome único
   * ("Ana 7"), então os testes não dividem usuários sem querer.
   */
  async connect(label: string): Promise<TestClient> {
    const { body } = await this.login(`${label} ${++accountCounter}`, DEFAULT_PIN);
    if (!body.ok) throw new Error(`Login falhou: ${body.error}`);
    return this.connectWithToken(body.token);
  }

  /** Conecta com um token de sessão, como o navegador faz depois do primeiro login. */
  async connectWithToken(token: string): Promise<TestClient> {
    const socket: TestSocket = connectSocket(this.url, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
    });
    this.clients.push(socket);
    const ready = await new Promise<Parameters<ServerToClientEvents['session:ready']>[0]>((resolve, reject) => {
      socket.once('session:ready', resolve);
      socket.once('connect_error', reject);
    });
    return { socket, token, ...ready };
  }

  /**
   * Desconecta todos os clientes e espera o servidor terminar de processar as
   * saídas (presença, salas de voz), para um teste não vazar estado no próximo.
   */
  async disconnectAll(): Promise<void> {
    for (const socket of this.clients.splice(0)) socket.disconnect();
    for (let tries = 0; tries < 50 && this.server; tries++) {
      if ((await this.server.io.fetchSockets()).length === 0 &&
        [...(this.store?.voice.values() ?? [])].every((session) => session.socketId === BOT_SOCKET_ID)) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  private async boot(): Promise<void> {
    this.store = await Store.load(this.db);
    this.server = await startServer(this.store, {
      port: 0,
      clientOrigins: [],
      uploadDir: this.uploadDir,
      ice: iceConfigFromEnv({}),
      sfu: this.sfu,
      music: this.music,
    });
  }
}

async function resetDatabase(db: Db): Promise<void> {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
}

/** Desembrulha uma resposta de ack, falhando o teste com a mensagem do servidor. */
export function ok<T>(res: Ack<T>): T {
  if (!res.ok) throw new Error(`O servidor recusou: ${res.error}`);
  return res.data;
}

/** Espera o próximo evento (que passe no filtro). Registre antes de disparar a ação. */
export function nextEvent<E extends EventName>(
  socket: TestSocket,
  event: E,
  filter?: (payload: EventPayload<E>) => boolean,
  timeoutMs = 3_000,
): Promise<EventPayload<E>> {
  return new Promise((resolve, reject) => {
    const handler = (payload: EventPayload<E>) => {
      if (filter && !filter(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler as never);
      resolve(payload);
    };
    const timer = setTimeout(() => {
      socket.off(event, handler as never);
      reject(new Error(`O evento "${event}" não chegou em ${timeoutMs} ms.`));
    }, timeoutMs);
    socket.on(event, handler as never);
  });
}

/** Falha se o evento chegar dentro da janela; útil para provar que algo não vazou. */
export function expectNoEvent<E extends EventName>(socket: TestSocket, event: E, windowMs = 400): Promise<void> {
  return new Promise((resolve, reject) => {
    const handler = () => {
      clearTimeout(timer);
      reject(new Error(`O evento "${event}" chegou, mas não deveria.`));
    };
    const timer = setTimeout(() => {
      socket.off(event, handler as never);
      resolve();
    }, windowMs);
    socket.on(event, handler as never);
  });
}

/** Início de um PNG com as dimensões pedidas; o servidor só lê o cabeçalho. */
export function fakePng(width: number, height: number, extraBytes = 32): Buffer {
  const header = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header);
  header.writeUInt32BE(13, 8);
  header.write('IHDR', 12, 'latin1');
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return Buffer.concat([header, Buffer.alloc(extraBytes, 7)]);
}

/** Abre o primeiro espaço de demonstração ("Coreto Dev") e devolve o retrato dele. */
export async function joinDemoSpace(client: TestClient): Promise<SpaceSnapshot> {
  const space = client.spaces.find((s) => s.name === 'Coreto Dev');
  if (!space) throw new Error('Espaço de demonstração não encontrado.');
  return ok(await client.socket.emitWithAck('space:join', space.id));
}

export function channelNamed(snapshot: SpaceSnapshot, name: string): Channel {
  const channel = snapshot.channels.find((c) => c.name === name);
  if (!channel) throw new Error(`Canal "${name}" não está no retrato do espaço.`);
  return channel;
}

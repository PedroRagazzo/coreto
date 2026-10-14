// Sobe o servidor real numa porta livre contra o banco de teste e conecta
// clientes socket.io como se fossem navegadores.

import { randomUUID } from 'node:crypto';
import { io as connectSocket, type Socket } from 'socket.io-client';
import type { Channel, DirectConversation, Space, SpaceSnapshot, User } from '../../../shared/src/models.js';
import type { Ack, ClientToServerEvents, ServerToClientEvents } from '../../../shared/src/protocol.js';
import { startServer, type RunningServer } from '../../src/app.js';
import { createDb, type Db } from '../../src/db/client.js';
import { seedIfEmpty } from '../../src/seed.js';
import { Store } from '../../src/store.js';
import { assertTestDatabase, TEST_DATABASE_URL } from './database.js';

export type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export interface TestClient {
  socket: TestSocket;
  token: string;
  user: User;
  spaces: Space[];
  directs: DirectConversation[];
  directUsers: User[];
}

type EventName = keyof ServerToClientEvents;
type EventPayload<E extends EventName> = Parameters<ServerToClientEvents[E]>[0];

export class TestServer {
  private server: RunningServer | null = null;
  private store: Store | null = null;
  private readonly clients: TestSocket[] = [];

  private constructor(readonly db: Db) {}

  /** Apaga o banco de teste, recria os dados de demonstração e sobe o servidor. */
  static async start(): Promise<TestServer> {
    if (!TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL não definida.');
    assertTestDatabase(TEST_DATABASE_URL);
    const db = createDb(TEST_DATABASE_URL);
    await resetDatabase(db);
    await seedIfEmpty(db);
    const harness = new TestServer(db);
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
  }

  /** Conecta um cliente; o mesmo `token` volta como o mesmo usuário. */
  async connect(name: string, token = `token-${randomUUID()}`): Promise<TestClient> {
    const socket: TestSocket = connectSocket(this.url, {
      auth: { token, displayName: name },
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
      if ((await this.server.io.fetchSockets()).length === 0 && this.store?.voice.size === 0) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  private async boot(): Promise<void> {
    this.store = await Store.load(this.db);
    this.server = await startServer(this.store, { port: 0, clientOrigins: [] });
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

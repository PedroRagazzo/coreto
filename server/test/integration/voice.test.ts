import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { SignalPayload } from '../../../shared/src/protocol.js';
import { hasTestDatabase } from '../support/database.js';
import { channelNamed, expectNoEvent, joinDemoSpace, nextEvent, ok, TestServer, type TestClient } from '../support/harness.js';

const offer: SignalPayload = { kind: 'description', description: { type: 'offer', sdp: 'v=0' } };

describe.skipIf(!hasTestDatabase)('salas de voz', () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await TestServer.start();
  });
  afterEach(() => server.disconnectAll());
  afterAll(() => server?.stop());

  /** Conecta alguém, abre o espaço de demonstração e entra na sala de voz pedida. */
  async function inRoom(name: string, room: string): Promise<{ client: TestClient; peers: string[] }> {
    const client = await server.connect(name);
    const sala = channelNamed(await joinDemoSpace(client), room);
    const { peers } = ok(await client.socket.emitWithAck('voice:join', { channelId: sala.id }));
    return { client, peers };
  }

  it('entrega ao recém-chegado a lista de quem já está na sala', async () => {
    const ana = await inRoom('Ana', 'Sala de estar');
    expect(ana.peers).toEqual([]);

    const roster = nextEvent(ana.client.socket, 'voice:update', (p) => p.participants.length === 2);
    const bruno = await inRoom('Bruno', 'Sala de estar');
    expect(bruno.peers).toEqual([ana.client.user.id]);
    expect((await roster).participants.map((p) => p.userId).sort()).toEqual(
      [ana.client.user.id, bruno.client.user.id].sort(),
    );
  });

  it('entrega os servidores ICE e a política de transporte ao entrar', async () => {
    const client = await server.connect('Ana');
    const sala = channelNamed(await joinDemoSpace(client), 'Sala de estar');
    const joined = ok(await client.socket.emitWithAck('voice:join', { channelId: sala.id }));
    expect(joined.iceServers.length).toBeGreaterThan(0);
    expect(joined.iceTransportPolicy).toBe('all');
  });

  it('repassa a sinalização só entre quem está na mesma sala', async () => {
    const ana = await inRoom('Ana', 'Sala de estar');
    const bruno = await inRoom('Bruno', 'Sala de estar');
    const carla = await inRoom('Carla', 'Pareamento');

    const signal = nextEvent(bruno.client.socket, 'voice:signal');
    ana.client.socket.emit('voice:signal', { to: bruno.client.user.id, signal: offer });
    expect(await signal).toEqual({ from: ana.client.user.id, signal: offer });

    const nothing = expectNoEvent(carla.client.socket, 'voice:signal');
    ana.client.socket.emit('voice:signal', { to: carla.client.user.id, signal: offer });
    await nothing;
  });

  it('avisa os outros quando alguém sai da sala ou cai', async () => {
    const ana = await inRoom('Ana', 'Sala de estar');
    const bruno = await inRoom('Bruno', 'Sala de estar');
    const carla = await inRoom('Carla', 'Sala de estar');

    const brunoLeft = nextEvent(ana.client.socket, 'voice:peer-left', (p) => p.userId === bruno.client.user.id);
    bruno.client.socket.emit('voice:leave');
    await brunoLeft;

    const carlaLeft = nextEvent(ana.client.socket, 'voice:peer-left', (p) => p.userId === carla.client.user.id);
    carla.client.socket.disconnect();
    await carlaLeft;
  });

  it('entrar em outra sala tira a pessoa da anterior', async () => {
    const ana = await inRoom('Ana', 'Sala de estar');
    const bruno = await inRoom('Bruno', 'Sala de estar');
    const left = nextEvent(ana.client.socket, 'voice:peer-left', (p) => p.userId === bruno.client.user.id);
    const pareamento = channelNamed(await joinDemoSpace(bruno.client), 'Pareamento');
    ok(await bruno.client.socket.emitWithAck('voice:join', { channelId: pareamento.id }));
    await left;
  });
});

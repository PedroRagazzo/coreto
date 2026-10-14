import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDatabase } from '../support/database.js';
import { joinDemoSpace, nextEvent, TestServer } from '../support/harness.js';

describe.skipIf(!hasTestDatabase)('sessão e presença', () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await TestServer.start();
  });
  afterEach(() => server.disconnectAll());
  afterAll(() => server?.stop());

  it('recusa conexão sem identificação válida', async () => {
    await expect(server.connect('Ana', 'curto')).rejects.toThrow('Identificação inválida.');
    await expect(server.connect('   ')).rejects.toThrow('Identificação inválida.');
  });

  it('reconhece a mesma pessoa pelo token, inclusive depois de reiniciar o servidor', async () => {
    const token = 'token-fixo-da-ana-para-teste';
    const first = await server.connect('Ana', token);
    await server.restart();
    const again = await server.connect('Ana Maria', token);
    expect(again.user.id).toBe(first.user.id);
    expect(again.user.displayName).toBe('Ana Maria');
  });

  it('faz quem chega virar membro dos espaços públicos e avisa quem já está lá', async () => {
    const ana = await server.connect('Ana');
    await joinDemoSpace(ana);
    const joined = nextEvent(ana.socket, 'member:joined', (p) => p.user.displayName === 'Bruno');
    const bruno = await server.connect('Bruno');
    expect(bruno.spaces.map((s) => s.name).sort()).toEqual(['Clube do Livro', 'Coreto Dev']);
    expect((await joined).member.userId).toBe(bruno.user.id);
  });

  it('avisa quando alguém fica online, muda de status e sai', async () => {
    const ana = await server.connect('Ana');
    await joinDemoSpace(ana);
    const online = nextEvent(ana.socket, 'presence:update', (p) => p.status === 'online');
    const bruno = await server.connect('Bruno');
    expect((await online).userId).toBe(bruno.user.id);

    const idle = nextEvent(ana.socket, 'presence:update', (p) => p.userId === bruno.user.id && p.status === 'idle');
    bruno.socket.emit('presence:set', 'idle');
    await idle;

    const offline = nextEvent(ana.socket, 'presence:update', (p) => p.userId === bruno.user.id && p.status === 'offline');
    bruno.socket.disconnect();
    await offline;
  });

  it('conta várias abas como uma presença só', async () => {
    const ana = await server.connect('Ana');
    await joinDemoSpace(ana);
    const token = 'token-do-bruno-com-duas-abas';
    const firstTab = await server.connect('Bruno', token);
    await server.connect('Bruno', token);

    let wentOffline = false;
    ana.socket.on('presence:update', (p) => {
      if (p.userId === firstTab.user.id && p.status === 'offline') wentOffline = true;
    });
    firstTab.socket.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(wentOffline).toBe(false);
  });
});

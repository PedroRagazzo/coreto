import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDatabase } from '../support/database.js';
import { channelNamed, expectNoEvent, joinDemoSpace, nextEvent, ok, TestServer } from '../support/harness.js';

describe.skipIf(!hasTestDatabase)('mensagens não lidas', () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await TestServer.start();
  });
  afterEach(() => server.disconnectAll());
  afterAll(() => server?.stop());

  /** Quantas não lidas há num lugar, vistas por quem acaba de entrar com este token. */
  async function unreadSeenBy(token: string, channelId: string): Promise<number> {
    const again = await server.connectWithToken(token);
    return again.unread.find((u) => u.channelId === channelId)?.count ?? 0;
  }

  it('conta o que os outros escreveram depois de você ler, e some quando você marca como lido', async () => {
    const ana = await server.connect('Ana');
    const bruno = await server.connect('Bruno');
    const geral = channelNamed(await joinDemoSpace(ana), 'geral');
    await joinDemoSpace(bruno);

    // Quem entra pela primeira vez começa com tudo lido, por mais histórico que já exista.
    expect(ana.unread).toEqual([]);

    ok(await bruno.socket.emitWithAck('message:send', { channelId: geral.id, content: 'um' }));
    ok(await bruno.socket.emitWithAck('message:send', { channelId: geral.id, content: 'dois' }));
    // As próprias mensagens não contam.
    ok(await ana.socket.emitWithAck('message:send', { channelId: geral.id, content: 'minha' }));

    expect(await unreadSeenBy(ana.token, geral.id)).toBe(2);
    const [seen] = (await server.connectWithToken(ana.token)).unread.filter((u) => u.channelId === geral.id);
    expect(seen.spaceId).toBe(geral.spaceId);

    ana.socket.emit('read:mark', { channelId: geral.id });
    // O servidor grava sem confirmar; espera até o próximo "entrar" já ver zero.
    await expectUnread(ana.token, geral.id, 0);

    ok(await bruno.socket.emitWithAck('message:send', { channelId: geral.id, content: 'três' }));
    expect(await unreadSeenBy(ana.token, geral.id)).toBe(1);
  });

  async function expectUnread(token: string, channelId: string, expected: number) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const count = await unreadSeenBy(token, channelId);
      if (count === expected) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(await unreadSeenBy(token, channelId)).toBe(expected);
  }

  it('avisa ao vivo só quem lê o canal, e não quem escreveu', async () => {
    const ana = await server.connect('Ana');
    const bruno = await server.connect('Bruno');
    const geral = channelNamed(await joinDemoSpace(ana), 'geral');
    await joinDemoSpace(bruno);

    const bump = nextEvent(ana.socket, 'unread:bump', (b) => b.channelId === geral.id);
    const own = expectNoEvent(bruno.socket, 'unread:bump');
    ok(await bruno.socket.emitWithAck('message:send', { channelId: geral.id, content: 'olá' }));
    expect(await bump).toEqual({ channelId: geral.id, spaceId: geral.spaceId });
    await own;
  });

  it('não avisa quem não enxerga o canal', async () => {
    const ana = await server.connect('Ana');
    const bruno = await server.connect('Bruno');
    const snapshot = await joinDemoSpace(ana);
    await joinDemoSpace(bruno);
    const moderacao = snapshot.channels.find((c) => c.name === 'moderação');
    // O canal só existe para a moderação; quem é membro comum nem o vê, então não é avisado.
    server.makeSuperAdmin(ana.user.displayName);
    const again = await server.connectWithToken(ana.token);
    const adminView = await joinDemoSpace(again);
    const hidden = adminView.channels.find((c) => c.name === 'moderação') ?? moderacao;
    expect(hidden).toBeDefined();

    const blind = expectNoEvent(bruno.socket, 'unread:bump', 600);
    ok(await again.socket.emitWithAck('message:send', { channelId: hidden!.id, content: 'segredo da moderação' }));
    await blind;
    // E, na contagem ao entrar, também não aparece.
    expect((await server.connectWithToken(bruno.token)).unread.some((u) => u.channelId === hidden!.id)).toBe(false);
  });

  it('conversas diretas: conta para quem recebeu, sem espaço, e só marca lido quem participa', async () => {
    const ana = await server.connect('Ana');
    const bruno = await server.connect('Bruno');
    const carla = await server.connect('Carla');
    const { conversation } = ok(await ana.socket.emitWithAck('dm:open', { userId: bruno.user.id }));

    const bump = nextEvent(bruno.socket, 'unread:bump', (b) => b.channelId === conversation.id);
    ok(await ana.socket.emitWithAck('message:send', { channelId: conversation.id, content: 'oi, Bruno' }));
    expect(await bump).toEqual({ channelId: conversation.id, spaceId: null });

    const again = await server.connectWithToken(bruno.token);
    expect(again.unread.find((u) => u.channelId === conversation.id)).toEqual({ channelId: conversation.id, spaceId: null, count: 1 });
    // Quem não participa não vê nem marca a conversa dos outros.
    expect((await server.connectWithToken(carla.token)).unread.some((u) => u.channelId === conversation.id)).toBe(false);
    carla.socket.emit('read:mark', { channelId: conversation.id });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await server.db.readState.count({ where: { userId: carla.user.id, channelId: conversation.id } })).toBe(0);
  });

  it('as não lidas continuam depois de reiniciar o servidor', async () => {
    const ana = await server.connect('Ana');
    const bruno = await server.connect('Bruno');
    const geral = channelNamed(await joinDemoSpace(ana), 'geral');
    await joinDemoSpace(bruno);
    await server.connectWithToken(ana.token); // garante a linha de leitura da Ana antes da mensagem
    ok(await bruno.socket.emitWithAck('message:send', { channelId: geral.id, content: 'fica' }));
    await server.restart();
    expect(await unreadSeenBy(ana.token, geral.id)).toBe(1);
  });
});

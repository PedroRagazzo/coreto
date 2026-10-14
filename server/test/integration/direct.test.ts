import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDatabase } from '../support/database.js';
import { expectNoEvent, joinDemoSpace, nextEvent, ok, TestServer } from '../support/harness.js';

describe.skipIf(!hasTestDatabase)('mensagens diretas', () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await TestServer.start();
  });
  afterEach(() => server.disconnectAll());
  afterAll(() => server?.stop());

  it('recusa conversa com robô e consigo mesmo', async () => {
    const ana = await server.connect('Ana');
    const bot = (await joinDemoSpace(ana)).users.find((u) => u.isBot);
    expect(await ana.socket.emitWithAck('dm:open', { userId: bot!.id })).toEqual({
      ok: false,
      error: 'Robôs não recebem mensagens diretas.',
    });
    expect((await ana.socket.emitWithAck('dm:open', { userId: ana.user.id })).ok).toBe(false);
  });

  it('só mostra a conversa ao destinatário quando chega a primeira mensagem', async () => {
    const ana = await server.connect('Ana');
    const bruno = await server.connect('Bruno');

    const silence = expectNoEvent(bruno.socket, 'dm:upsert');
    const { conversation } = ok(await ana.socket.emitWithAck('dm:open', { userId: bruno.user.id }));
    await silence;

    const order: string[] = [];
    bruno.socket.on('dm:upsert', () => order.push('dm:upsert'));
    bruno.socket.on('message:new', () => order.push('message:new'));
    const message = nextEvent(bruno.socket, 'message:new');
    ok(await ana.socket.emitWithAck('message:send', { channelId: conversation.id, content: 'oi, só pra você' }));
    expect((await message).content).toBe('oi, só pra você');
    // O destinatário precisa conhecer a conversa antes de receber a mensagem dela.
    expect(order).toEqual(['dm:upsert', 'message:new']);
  });

  it('abrir a conversa de novo devolve a mesma, de qualquer um dos lados', async () => {
    const ana = await server.connect('Ana');
    const bruno = await server.connect('Bruno');
    const first = ok(await ana.socket.emitWithAck('dm:open', { userId: bruno.user.id })).conversation;
    const again = ok(await ana.socket.emitWithAck('dm:open', { userId: bruno.user.id })).conversation;
    const fromOtherSide = ok(await bruno.socket.emitWithAck('dm:open', { userId: ana.user.id })).conversation;
    expect(again.id).toBe(first.id);
    expect(fromOtherSide.id).toBe(first.id);
  });

  it('não deixa uma terceira pessoa ler, escrever nem ver quem está digitando', async () => {
    const ana = await server.connect('Ana');
    const bruno = await server.connect('Bruno');
    const carla = await server.connect('Carla');
    const { conversation } = ok(await ana.socket.emitWithAck('dm:open', { userId: bruno.user.id }));
    ok(await ana.socket.emitWithAck('message:send', { channelId: conversation.id, content: 'segredo' }));

    expect((await carla.socket.emitWithAck('channel:history', { channelId: conversation.id })).ok).toBe(false);
    expect(
      (await carla.socket.emitWithAck('message:send', { channelId: conversation.id, content: 'intrusa' })).ok,
    ).toBe(false);

    const typing = nextEvent(bruno.socket, 'typing', (p) => p.channelId === conversation.id);
    const carlaSeesNothing = expectNoEvent(carla.socket, 'typing');
    ana.socket.emit('typing:start', { channelId: conversation.id });
    await typing;
    await carlaSeesNothing;
  });

  it('devolve as conversas ao reconectar, com quem está do outro lado', async () => {
    const ana = await server.connect('Ana');
    const bruno = await server.connect('Bruno', 'token-do-bruno-nas-conversas');
    const { conversation } = ok(await ana.socket.emitWithAck('dm:open', { userId: bruno.user.id }));
    ok(await ana.socket.emitWithAck('message:send', { channelId: conversation.id, content: 'volta depois' }));

    await server.restart();
    const again = await server.connect('Bruno', 'token-do-bruno-nas-conversas');
    expect(again.directs.map((d) => d.id)).toContain(conversation.id);
    expect(again.directUsers.map((u) => u.id)).toContain(ana.user.id);
    const history = ok(await again.socket.emitWithAck('channel:history', { channelId: conversation.id }));
    expect(history.map((m) => m.content)).toEqual(['volta depois']);
  });
});

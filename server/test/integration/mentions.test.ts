import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDatabase } from '../support/database.js';
import { channelNamed, expectNoEvent, joinDemoSpace, nextEvent, ok, TestServer } from '../support/harness.js';

const mention = (userId: string) => `<@${userId}>`;

describe.skipIf(!hasTestDatabase)('menções', () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await TestServer.start();
  });
  afterEach(() => server.disconnectAll());
  afterAll(() => server?.stop());

  it('avisa quem foi mencionado mesmo fora do espaço, guarda até ser vista e zera em todas as abas', async () => {
    const ana = await server.connect('Ana');
    const bruno = await server.connect('Bruno'); // não abriu espaço nenhum
    const snapshot = await joinDemoSpace(ana);
    const geral = channelNamed(snapshot, 'geral');

    const update = nextEvent(bruno.socket, 'mentions:update');
    ok(await ana.socket.emitWithAck('message:send', { channelId: geral.id, content: `oi ${mention(bruno.user.id)}!` }));
    expect(await update).toEqual({ channelId: geral.id, spaceId: snapshot.space.id, count: 1 });

    // Outra aba (ou o navegador reaberto) recebe o total na chegada.
    const secondTab = await server.connectWithToken(bruno.token);
    expect(secondTab.mentions).toEqual([{ channelId: geral.id, spaceId: snapshot.space.id, count: 1 }]);

    const cleared = nextEvent(bruno.socket, 'mentions:update', (p) => p.count === 0);
    secondTab.socket.emit('mentions:ack', { channelId: geral.id });
    expect((await cleared).channelId).toBe(geral.id);
    const later = await server.connectWithToken(bruno.token);
    expect(later.mentions).toEqual([]);
  });

  it('não conta autoria, robôs, ids desconhecidos, menção em código nem conversas diretas', async () => {
    const ana = await server.connect('Ana');
    const bruno = await server.connect('Bruno');
    const snapshot = await joinDemoSpace(ana);
    const geral = channelNamed(snapshot, 'geral');
    const bot = snapshot.users.find((u) => u.isBot)!;

    const silence = expectNoEvent(bruno.socket, 'mentions:update');
    const content = `${mention(ana.user.id)} ${mention(bot.id)} ${mention('fantasma')} \`${mention(bruno.user.id)}\``;
    ok(await ana.socket.emitWithAck('message:send', { channelId: geral.id, content }));
    const { conversation } = ok(await ana.socket.emitWithAck('dm:open', { userId: bruno.user.id }));
    ok(await ana.socket.emitWithAck('message:send', { channelId: conversation.id, content: mention(bruno.user.id) }));
    await silence;
    expect(await server.db.mention.count()).toBe(0);
  });

  it('não registra menção a quem não enxerga o canal', async () => {
    const ana = await server.connect('Ana');
    const bruno = await server.connect('Bruno');
    const snapshot = await joinDemoSpace(ana);
    // Ana entra para a Moderação direto no banco e o servidor recarrega.
    const moderation = snapshot.roles.find((r) => r.name === 'Moderação')!;
    await server.db.memberRole.create({ data: { spaceId: snapshot.space.id, userId: ana.user.id, roleId: moderation.id } });
    await server.restart();

    const moderator = await server.connectWithToken(ana.token);
    const hidden = channelNamed(await joinDemoSpace(moderator), 'moderação');
    const outsider = await server.connectWithToken(bruno.token);
    const silence = expectNoEvent(outsider.socket, 'mentions:update');
    ok(await moderator.socket.emitWithAck('message:send', { channelId: hidden.id, content: `${mention(bruno.user.id)} psiu` }));
    await silence;
    expect(await server.db.mention.count({ where: { userId: bruno.user.id } })).toBe(0);
  });

  it('acompanha edição e exclusão da mensagem', async () => {
    const ana = await server.connect('Ana');
    const bruno = await server.connect('Bruno');
    const carla = await server.connect('Carla');
    const geral = channelNamed(await joinDemoSpace(ana), 'geral');
    const first = nextEvent(bruno.socket, 'mentions:update', (p) => p.count === 1);
    const sent = ok(await ana.socket.emitWithAck('message:send', { channelId: geral.id, content: mention(bruno.user.id) }));
    await first;

    // Troca Bruno por Carla: Bruno perde a menção, Carla ganha.
    const brunoCleared = nextEvent(bruno.socket, 'mentions:update', (p) => p.count === 0);
    const carlaMentioned = nextEvent(carla.socket, 'mentions:update', (p) => p.count === 1);
    ok(await ana.socket.emitWithAck('message:edit', { messageId: sent.id, content: `na verdade, ${mention(carla.user.id)}` }));
    await brunoCleared;
    await carlaMentioned;

    // Uma correção de digitação não avisa de novo quem já estava mencionado.
    const noRepeat = expectNoEvent(carla.socket, 'mentions:update');
    ok(await ana.socket.emitWithAck('message:edit', { messageId: sent.id, content: `na verdade, ${mention(carla.user.id)}!` }));
    await noRepeat;

    const carlaCleared = nextEvent(carla.socket, 'mentions:update', (p) => p.count === 0);
    ok(await ana.socket.emitWithAck('message:delete', { messageId: sent.id }));
    await carlaCleared;
  });

  it('zera as menções de um canal excluído, mesmo para quem está em outro espaço', async () => {
    const dona = await server.connect('Dona');
    const bruno = await server.connect('Bruno');
    const space = ok(await dona.socket.emitWithAck('space:create', { name: 'Temporário' }));
    const geral = channelNamed(ok(await dona.socket.emitWithAck('space:join', space.id)), 'geral');
    const mentioned = nextEvent(bruno.socket, 'mentions:update', (p) => p.count === 1);
    ok(await dona.socket.emitWithAck('message:send', { channelId: geral.id, content: mention(bruno.user.id) }));
    await mentioned;

    const cleared = nextEvent(bruno.socket, 'mentions:update', (p) => p.count === 0);
    ok(await dona.socket.emitWithAck('channel:delete', { channelId: geral.id }));
    expect(await cleared).toEqual({ channelId: geral.id, spaceId: space.id, count: 0 });
  });
});

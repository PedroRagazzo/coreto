import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDatabase } from '../support/database.js';
import { channelNamed, expectNoEvent, joinDemoSpace, nextEvent, ok, TestServer } from '../support/harness.js';

describe.skipIf(!hasTestDatabase)('mensagens em canais', () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await TestServer.start();
  });
  afterEach(() => server.disconnectAll());
  afterAll(() => server?.stop());

  it('entrega a mensagem a quem está no canal e guarda no histórico', async () => {
    const ana = await server.connect('Ana');
    const bruno = await server.connect('Bruno');
    const geral = channelNamed(await joinDemoSpace(ana), 'geral');
    await joinDemoSpace(bruno);

    const received = nextEvent(bruno.socket, 'message:new', (m) => m.channelId === geral.id);
    const sent = ok(await ana.socket.emitWithAck('message:send', { channelId: geral.id, content: '  olá, Bruno  ' }));
    expect(sent.content).toBe('olá, Bruno');
    expect((await received).id).toBe(sent.id);

    const history = ok(await bruno.socket.emitWithAck('channel:history', { channelId: geral.id }));
    expect(history.at(-1)).toEqual(sent);
  });

  it('mantém a ordem e pagina o histórico para trás', async () => {
    const ana = await server.connect('Ana');
    const ajuda = channelNamed(await joinDemoSpace(ana), 'ajuda');
    for (let i = 1; i <= 5; i++) {
      ok(await ana.socket.emitWithAck('message:send', { channelId: ajuda.id, content: `m${i}` }));
    }

    const latest = ok(await ana.socket.emitWithAck('channel:history', { channelId: ajuda.id, limit: 2 }));
    expect(latest.map((m) => m.content)).toEqual(['m4', 'm5']);
    const older = ok(
      await ana.socket.emitWithAck('channel:history', { channelId: ajuda.id, before: latest[0].id, limit: 2 }),
    );
    expect(older.map((m) => m.content)).toEqual(['m2', 'm3']);
  });

  it('recusa mensagem vazia ou longa demais', async () => {
    const ana = await server.connect('Ana');
    const geral = channelNamed(await joinDemoSpace(ana), 'geral');
    expect(await ana.socket.emitWithAck('message:send', { channelId: geral.id, content: '   ' })).toEqual({
      ok: false,
      error: 'A mensagem está vazia.',
    });
    const tooLong = await ana.socket.emitWithAck('message:send', { channelId: geral.id, content: 'x'.repeat(2001) });
    expect(tooLong.ok).toBe(false);
  });

  it('não deixa um membro comum escrever em #avisos, mas deixa ler', async () => {
    const ana = await server.connect('Ana');
    const snapshot = await joinDemoSpace(ana);
    const avisos = channelNamed(snapshot, 'avisos');
    const denied = await ana.socket.emitWithAck('message:send', { channelId: avisos.id, content: 'oi' });
    expect(denied.ok).toBe(false);
    const history = ok(await ana.socket.emitWithAck('channel:history', { channelId: avisos.id }));
    expect(history.length).toBeGreaterThan(0);
  });

  it('esconde #moderação de quem não é da moderação', async () => {
    const ana = await server.connect('Ana');
    const snapshot = await joinDemoSpace(ana);
    expect(snapshot.channels.map((c) => c.name)).not.toContain('moderação');

    // Mesmo sabendo o id, não dá para ler nem escrever.
    const hidden = await server.db.channel.findFirstOrThrow({ where: { name: 'moderação' } });
    expect((await ana.socket.emitWithAck('channel:history', { channelId: hidden.id })).ok).toBe(false);
    expect((await ana.socket.emitWithAck('message:send', { channelId: hidden.id, content: 'oi' })).ok).toBe(false);
  });

  it('avisa os outros que alguém está digitando, mas não quem digita', async () => {
    const ana = await server.connect('Ana');
    const bruno = await server.connect('Bruno');
    const geral = channelNamed(await joinDemoSpace(ana), 'geral');
    await joinDemoSpace(bruno);

    const typing = nextEvent(bruno.socket, 'typing', (p) => p.channelId === geral.id);
    const notToSelf = expectNoEvent(ana.socket, 'typing');
    ana.socket.emit('typing:start', { channelId: geral.id });
    expect((await typing).userId).toBe(ana.user.id);
    await notToSelf;
  });

  it('mantém as mensagens depois de reiniciar o servidor', async () => {
    const ana = await server.connect('Ana');
    const geral = channelNamed(await joinDemoSpace(ana), 'geral');
    const sent = ok(await ana.socket.emitWithAck('message:send', { channelId: geral.id, content: 'sobrevive ao reinício' }));

    await server.restart();
    const bruno = await server.connect('Bruno');
    await joinDemoSpace(bruno);
    const history = ok(await bruno.socket.emitWithAck('channel:history', { channelId: geral.id }));
    expect(history.map((m) => m.id)).toContain(sent.id);
  });
});

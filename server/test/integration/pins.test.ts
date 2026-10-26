import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MAX_PINS_PER_CHANNEL } from '../../../shared/src/protocol.js';
import { hasTestDatabase } from '../support/database.js';
import { channelNamed, expectNoEvent, joinDemoSpace, nextEvent, ok, TestServer } from '../support/harness.js';

describe.skipIf(!hasTestDatabase)('mensagens fixadas', () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await TestServer.start();
  });
  afterEach(() => server.disconnectAll());
  afterAll(() => server?.stop());

  async function twoInGeral() {
    const ana = await server.connect('Ana');
    const bruno = await server.connect('Bruno');
    const geral = channelNamed(await joinDemoSpace(ana), 'geral');
    await joinDemoSpace(bruno);
    return { ana, bruno, geral };
  }

  it('qualquer pessoa que escreve no canal fixa, todo mundo é avisado e o histórico guarda', async () => {
    const { ana, bruno, geral } = await twoInGeral();
    const message = ok(await ana.socket.emitWithAck('message:send', { channelId: geral.id, content: 'regras do canal' }));
    expect(message).toMatchObject({ pinnedAt: null, pinnedById: null });

    const seen = nextEvent(ana.socket, 'message:pinned', (p) => p.messageId === message.id);
    ok(await bruno.socket.emitWithAck('message:pin', { messageId: message.id, pinned: true }));
    const event = await seen;
    expect(event).toMatchObject({ channelId: geral.id, pinnedById: bruno.user.id });
    expect(event.pinnedAt).toBeTruthy();

    const history = ok(await ana.socket.emitWithAck('channel:history', { channelId: geral.id }));
    expect(history.find((m) => m.id === message.id)).toMatchObject({ pinnedAt: event.pinnedAt, pinnedById: bruno.user.id });
  });

  it('fixar de novo o que já está fixado não faz nada (nem muda a hora)', async () => {
    const { ana, bruno, geral } = await twoInGeral();
    const message = ok(await ana.socket.emitWithAck('message:send', { channelId: geral.id, content: 'uma vez só' }));
    const first = nextEvent(ana.socket, 'message:pinned', (p) => p.messageId === message.id);
    const firstForBruno = nextEvent(bruno.socket, 'message:pinned', (p) => p.messageId === message.id);
    ok(await ana.socket.emitWithAck('message:pin', { messageId: message.id, pinned: true }));
    const { pinnedAt } = await first;
    await firstForBruno;

    const again = expectNoEvent(bruno.socket, 'message:pinned', 400);
    ok(await bruno.socket.emitWithAck('message:pin', { messageId: message.id, pinned: true }));
    await again;
    const list = ok(await ana.socket.emitWithAck('pins:list', { channelId: geral.id }));
    expect(list.find((m) => m.id === message.id)?.pinnedAt).toBe(pinnedAt);
  });

  it('a lista traz as fixadas, a de fixação mais recente primeiro; desafixar tira da lista', async () => {
    const { ana, geral } = await twoInGeral();
    const [a, b, c] = [
      ok(await ana.socket.emitWithAck('message:send', { channelId: geral.id, content: 'A' })),
      ok(await ana.socket.emitWithAck('message:send', { channelId: geral.id, content: 'B' })),
      ok(await ana.socket.emitWithAck('message:send', { channelId: geral.id, content: 'C (não fixada)' })),
    ];
    ok(await ana.socket.emitWithAck('message:pin', { messageId: b.id, pinned: true }));
    await new Promise((r) => setTimeout(r, 15));
    ok(await ana.socket.emitWithAck('message:pin', { messageId: a.id, pinned: true }));

    const ids = async () => ok(await ana.socket.emitWithAck('pins:list', { channelId: geral.id })).map((m) => m.id);
    const mine = (list: string[]) => list.filter((id) => [a.id, b.id, c.id].includes(id));
    expect(mine(await ids())).toEqual([a.id, b.id]);

    const removed = nextEvent(ana.socket, 'message:pinned', (p) => p.messageId === a.id);
    ok(await ana.socket.emitWithAck('message:pin', { messageId: a.id, pinned: false }));
    expect(await removed).toMatchObject({ pinnedAt: null, pinnedById: null });
    expect(mine(await ids())).toEqual([b.id]);
  });

  it('apagar uma mensagem fixada a tira da lista', async () => {
    const { ana, geral } = await twoInGeral();
    const message = ok(await ana.socket.emitWithAck('message:send', { channelId: geral.id, content: 'vou sumir' }));
    ok(await ana.socket.emitWithAck('message:pin', { messageId: message.id, pinned: true }));
    ok(await ana.socket.emitWithAck('message:delete', { messageId: message.id }));
    const list = ok(await ana.socket.emitWithAck('pins:list', { channelId: geral.id }));
    expect(list.map((m) => m.id)).not.toContain(message.id);
  });

  it('há um limite de fixadas por canal', async () => {
    const { ana, geral } = await twoInGeral();
    const extra = ok(await ana.socket.emitWithAck('message:send', { channelId: geral.id, content: 'a que não cabe' }));
    // Enche o canal de fixadas direto no banco: fixar uma a uma bateria no limite de ritmo da conexão.
    const base = ok(await ana.socket.emitWithAck('pins:list', { channelId: geral.id })).length;
    const filling: string[] = [];
    for (let i = 0; i < MAX_PINS_PER_CHANNEL - base; i++) {
      filling.push(ok(await ana.socket.emitWithAck('message:send', { channelId: geral.id, content: `enchimento ${i}` })).id);
    }
    await server.db.message.updateMany({ where: { id: { in: filling } }, data: { pinnedAt: new Date(), pinnedById: ana.user.id } });

    const refused = await ana.socket.emitWithAck('message:pin', { messageId: extra.id, pinned: true });
    expect(refused.ok).toBe(false);
    // Desafixar uma abre espaço.
    ok(await ana.socket.emitWithAck('message:pin', { messageId: filling[0]!, pinned: false }));
    ok(await ana.socket.emitWithAck('message:pin', { messageId: extra.id, pinned: true }));
  });

  it('funciona numa conversa direta, e quem não participa não fixa nem lê', async () => {
    const ana = await server.connect('Ana');
    const bruno = await server.connect('Bruno');
    const carla = await server.connect('Carla');
    const dm = ok(await ana.socket.emitWithAck('dm:open', { userId: bruno.user.id }));
    const message = ok(await ana.socket.emitWithAck('message:send', { channelId: dm.conversation.id, content: 'nosso endereço' }));

    expect((await carla.socket.emitWithAck('message:pin', { messageId: message.id, pinned: true })).ok).toBe(false);
    expect((await carla.socket.emitWithAck('pins:list', { channelId: dm.conversation.id })).ok).toBe(false);

    const seen = nextEvent(ana.socket, 'message:pinned', (p) => p.messageId === message.id);
    ok(await bruno.socket.emitWithAck('message:pin', { messageId: message.id, pinned: true }));
    expect((await seen).channelId).toBe(dm.conversation.id);
    expect(ok(await ana.socket.emitWithAck('pins:list', { channelId: dm.conversation.id })).map((m) => m.id)).toEqual([message.id]);
  });

  it('recusa pedidos malformados e mensagens que não existem', async () => {
    const { ana } = await twoInGeral();
    expect((await ana.socket.emitWithAck('message:pin', { messageId: 'nao-existe', pinned: true })).ok).toBe(false);
    expect((await ana.socket.emitWithAck('message:pin', { messageId: 'x', pinned: 'sim' as unknown as boolean })).ok).toBe(false);
    expect((await ana.socket.emitWithAck('pins:list', { channelId: 'canal-que-nao-existe' })).ok).toBe(false);
  });
});

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDatabase } from '../support/database.js';
import { channelNamed, expectNoEvent, joinDemoSpace, nextEvent, ok, TestServer } from '../support/harness.js';

describe.skipIf(!hasTestDatabase)('enquetes e roletas', () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await TestServer.start();
  });
  afterEach(() => server.disconnectAll());
  afterAll(() => server?.stop());

  async function threeInGeral() {
    const ana = await server.connect('Ana');
    const bruno = await server.connect('Bruno');
    const carla = await server.connect('Carla');
    const geral = channelNamed(await joinDemoSpace(ana), 'geral');
    await joinDemoSpace(bruno);
    await joinDemoSpace(carla);
    return { ana, bruno, carla, geral };
  }

  const newPoll = (channelId: string, extra: { multiple?: boolean; options?: string[] } = {}) => ({
    channelId,
    question: 'Que jogo hoje?',
    options: extra.options ?? ['Minecraft', 'Valorant', 'Among Us'],
    multiple: extra.multiple,
  });

  describe('enquete', () => {
    it('vira uma mensagem do canal: a pergunta é o texto, e todo mundo recebe', async () => {
      const { ana, bruno, geral } = await threeInGeral();
      const received = nextEvent(bruno.socket, 'message:new', (m) => m.authorId === ana.user.id);
      const message = ok(await ana.socket.emitWithAck('poll:create', newPoll(geral.id)));

      expect(message.content).toBe('Que jogo hoje?');
      expect(message.roulette).toBeNull();
      expect(message.poll).toMatchObject({ multiple: false, closed: false });
      expect(message.poll!.options.map((o) => [o.text, o.userIds])).toEqual([
        ['Minecraft', []],
        ['Valorant', []],
        ['Among Us', []],
      ]);
      expect((await received).poll?.options).toHaveLength(3);

      const history = ok(await bruno.socket.emitWithAck('channel:history', { channelId: geral.id }));
      expect(history.at(-1)?.poll?.options.map((o) => o.text)).toEqual(['Minecraft', 'Valorant', 'Among Us']);
    });

    it('recusa o que não vale, sem criar nada', async () => {
      const { ana, geral } = await threeInGeral();
      const before = ok(await ana.socket.emitWithAck('channel:history', { channelId: geral.id })).length;
      for (const bad of [
        { ...newPoll(geral.id), question: '   ' },
        newPoll(geral.id, { options: ['só uma'] }),
        newPoll(geral.id, { options: ['Sim', 'sim'] }),
        newPoll(geral.id, { options: Array.from({ length: 11 }, (_, i) => `o${i}`) }),
        { ...newPoll(geral.id), options: 'a,b' as unknown as string[] },
        newPoll('canal-que-nao-existe'),
      ]) {
        expect((await ana.socket.emitWithAck('poll:create', bad)).ok).toBe(false);
      }
      expect(ok(await ana.socket.emitWithAck('channel:history', { channelId: geral.id }))).toHaveLength(before);
    });

    it('uma resposta só: votar em outra opção troca o voto, e votar de novo na mesma tira', async () => {
      const { ana, bruno, geral } = await threeInGeral();
      const message = ok(await ana.socket.emitWithAck('poll:create', newPoll(geral.id)));
      const [minecraft, valorant] = message.poll!.options;

      const first = nextEvent(ana.socket, 'poll:updated', (p) => p.messageId === message.id);
      ok(await bruno.socket.emitWithAck('poll:vote', { messageId: message.id, optionId: minecraft!.id }));
      const afterFirst = await first;
      expect(afterFirst.channelId).toBe(geral.id);
      expect(afterFirst.poll.options.map((o) => o.userIds)).toEqual([[bruno.user.id], [], []]);

      const second = nextEvent(ana.socket, 'poll:updated', (p) => p.messageId === message.id);
      ok(await bruno.socket.emitWithAck('poll:vote', { messageId: message.id, optionId: valorant!.id }));
      expect((await second).poll.options.map((o) => o.userIds)).toEqual([[], [bruno.user.id], []]);

      const third = nextEvent(ana.socket, 'poll:updated', (p) => p.messageId === message.id);
      ok(await bruno.socket.emitWithAck('poll:vote', { messageId: message.id, optionId: valorant!.id }));
      expect((await third).poll.options.map((o) => o.userIds)).toEqual([[], [], []]);
    });

    it('várias respostas: cada opção marcada é um voto', async () => {
      const { ana, bruno, geral } = await threeInGeral();
      const message = ok(await ana.socket.emitWithAck('poll:create', newPoll(geral.id, { multiple: true })));
      expect(message.poll!.multiple).toBe(true);
      const [a, b, c] = message.poll!.options;
      for (const option of [a, c]) ok(await bruno.socket.emitWithAck('poll:vote', { messageId: message.id, optionId: option!.id }));
      ok(await ana.socket.emitWithAck('poll:vote', { messageId: message.id, optionId: a!.id }));

      const history = ok(await ana.socket.emitWithAck('channel:history', { channelId: geral.id }));
      const poll = history.find((m) => m.id === message.id)!.poll!;
      expect(poll.options.map((o) => o.userIds)).toEqual([[bruno.user.id, ana.user.id], [], [bruno.user.id]]);
      expect(b).toBeTruthy();
    });

    it('dois votos ao mesmo tempo da mesma pessoa (duas abas) não deixam duas respostas numa enquete de uma só', async () => {
      const { ana, bruno, geral } = await threeInGeral();
      const message = ok(await ana.socket.emitWithAck('poll:create', newPoll(geral.id)));
      const second = await server.connectWithToken(bruno.token);
      await joinDemoSpace(second);
      const [a, b, c] = message.poll!.options;

      for (let round = 0; round < 6; round++) {
        await Promise.all([
          bruno.socket.emitWithAck('poll:vote', { messageId: message.id, optionId: a!.id }),
          second.socket.emitWithAck('poll:vote', { messageId: message.id, optionId: b!.id }),
          bruno.socket.emitWithAck('poll:vote', { messageId: message.id, optionId: c!.id }),
        ]);
        const history = ok(await ana.socket.emitWithAck('channel:history', { channelId: geral.id }));
        const votes = history.find((m) => m.id === message.id)!.poll!.options.flatMap((o) => o.userIds);
        expect(votes.length).toBeLessThanOrEqual(1);
      }
    });

    it('recusa voto em opção de outra enquete, em mensagem que não é enquete e em enquete encerrada', async () => {
      const { ana, bruno, geral } = await threeInGeral();
      const one = ok(await ana.socket.emitWithAck('poll:create', newPoll(geral.id)));
      const other = ok(await ana.socket.emitWithAck('poll:create', newPoll(geral.id)));
      const plain = ok(await ana.socket.emitWithAck('message:send', { channelId: geral.id, content: 'oi' }));

      expect((await bruno.socket.emitWithAck('poll:vote', { messageId: one.id, optionId: other.poll!.options[0]!.id })).ok).toBe(false);
      expect((await bruno.socket.emitWithAck('poll:vote', { messageId: plain.id, optionId: one.poll!.options[0]!.id })).ok).toBe(false);
      expect((await bruno.socket.emitWithAck('poll:vote', { messageId: 'nao-existe', optionId: 'x' })).ok).toBe(false);
      expect((await bruno.socket.emitWithAck('poll:vote', { messageId: one.id, optionId: 7 as unknown as string })).ok).toBe(false);

      ok(await ana.socket.emitWithAck('poll:close', { messageId: one.id }));
      const late = await bruno.socket.emitWithAck('poll:vote', { messageId: one.id, optionId: one.poll!.options[0]!.id });
      expect(late).toEqual({ ok: false, error: 'Esta enquete já foi encerrada.' });
    });

    it('só o autor (ou quem modera) encerra, e todo mundo vê encerrada', async () => {
      const { ana, bruno, carla, geral } = await threeInGeral();
      const message = ok(await ana.socket.emitWithAck('poll:create', newPoll(geral.id)));
      ok(await bruno.socket.emitWithAck('poll:vote', { messageId: message.id, optionId: message.poll!.options[0]!.id }));

      expect((await bruno.socket.emitWithAck('poll:close', { messageId: message.id })).ok).toBe(false);

      const closed = nextEvent(bruno.socket, 'poll:updated', (p) => p.messageId === message.id);
      ok(await ana.socket.emitWithAck('poll:close', { messageId: message.id }));
      const { poll } = await closed;
      expect(poll.closed).toBe(true);
      // Os votos que já existiam ficam.
      expect(poll.options[0]!.userIds).toEqual([bruno.user.id]);
      ok(await ana.socket.emitWithAck('poll:close', { messageId: message.id })); // de novo não faz mal

      const other = ok(await ana.socket.emitWithAck('poll:create', newPoll(geral.id)));
      server.makeSuperAdmin(carla.user.displayName);
      ok(await carla.socket.emitWithAck('poll:close', { messageId: other.id }));
    });

    it('não dá para editar: a mensagem é a enquete', async () => {
      const { ana, geral } = await threeInGeral();
      const message = ok(await ana.socket.emitWithAck('poll:create', newPoll(geral.id)));
      const res = await ana.socket.emitWithAck('message:edit', { messageId: message.id, content: 'outra pergunta' });
      expect(res.ok).toBe(false);
    });

    it('apagar a mensagem apaga a enquete e os votos', async () => {
      const { ana, bruno, geral } = await threeInGeral();
      const message = ok(await ana.socket.emitWithAck('poll:create', newPoll(geral.id)));
      ok(await bruno.socket.emitWithAck('poll:vote', { messageId: message.id, optionId: message.poll!.options[0]!.id }));
      ok(await ana.socket.emitWithAck('message:delete', { messageId: message.id }));
      expect(await server.db.poll.count({ where: { messageId: message.id } })).toBe(0);
      expect(await server.db.pollOption.count({ where: { pollId: message.id } })).toBe(0);
      expect(await server.db.pollVote.count({ where: { userId: bruno.user.id } })).toBe(0);
    });

    it('os votos sobrevivem a um reinício do servidor', async () => {
      const { ana, bruno, geral } = await threeInGeral();
      const message = ok(await ana.socket.emitWithAck('poll:create', newPoll(geral.id)));
      ok(await bruno.socket.emitWithAck('poll:vote', { messageId: message.id, optionId: message.poll!.options[1]!.id }));
      await server.restart();
      const again = await server.connectWithToken(ana.token);
      await joinDemoSpace(again);
      const history = ok(await again.socket.emitWithAck('channel:history', { channelId: geral.id }));
      expect(history.find((m) => m.id === message.id)!.poll!.options.map((o) => o.userIds)).toEqual([[], [bruno.user.id], []]);
    });

    it('funciona numa conversa direta, e quem não participa não vota nem vê', async () => {
      const ana = await server.connect('Ana');
      const bruno = await server.connect('Bruno');
      const carla = await server.connect('Carla');
      const dm = ok(await ana.socket.emitWithAck('dm:open', { userId: bruno.user.id }));
      const message = ok(await ana.socket.emitWithAck('poll:create', { ...newPoll(dm.conversation.id) }));
      const optionId = message.poll!.options[0]!.id;

      ok(await bruno.socket.emitWithAck('poll:vote', { messageId: message.id, optionId }));
      expect((await carla.socket.emitWithAck('poll:vote', { messageId: message.id, optionId })).ok).toBe(false);
      expect((await carla.socket.emitWithAck('poll:close', { messageId: message.id })).ok).toBe(false);
      const stranger = (await carla.socket.emitWithAck('poll:create', newPoll(dm.conversation.id))).ok;
      expect(stranger).toBe(false);
    });

    it('limita o ritmo dos votos de cada conexão', async () => {
      const { ana, bruno, geral } = await threeInGeral();
      const message = ok(await ana.socket.emitWithAck('poll:create', newPoll(geral.id, { multiple: true })));
      const optionId = message.poll!.options[0]!.id;
      const results = await Promise.all(
        Array.from({ length: 50 }, () => bruno.socket.emitWithAck('poll:vote', { messageId: message.id, optionId })),
      );
      expect(results.filter((r) => !r.ok).length).toBeGreaterThan(0);
    });
  });

  describe('roleta', () => {
    const newRoulette = (channelId: string, options = ['Minecraft', 'Valorant', 'Among Us', 'Fortnite']) => ({
      channelId,
      title: 'Que jogo hoje?',
      options,
    });

    it('vira uma mensagem do canal, com o título como texto e sem resultado ainda', async () => {
      const { ana, bruno, geral } = await threeInGeral();
      const received = nextEvent(bruno.socket, 'message:new', (m) => m.authorId === ana.user.id);
      const message = ok(await ana.socket.emitWithAck('roulette:create', newRoulette(geral.id)));
      expect(message.content).toBe('Que jogo hoje?');
      expect(message.poll).toBeNull();
      expect(message.roulette).toEqual({ options: ['Minecraft', 'Valorant', 'Among Us', 'Fortnite'], result: null, spunAt: null, spunById: null });
      expect((await received).roulette?.result).toBeNull();

      const untitled = ok(await ana.socket.emitWithAck('roulette:create', { channelId: geral.id, options: ['a', 'b'] }));
      expect(untitled.content).toBe('Roleta');
    });

    it('recusa o que não vale', async () => {
      const { ana, geral } = await threeInGeral();
      for (const bad of [
        newRoulette(geral.id, ['só uma']),
        newRoulette(geral.id, ['a', '  ', '']),
        newRoulette(geral.id, Array.from({ length: 51 }, (_, i) => `o${i}`)),
        newRoulette(geral.id, ['a', 'b'.repeat(61)]),
        newRoulette('canal-que-nao-existe'),
      ]) {
        expect((await ana.socket.emitWithAck('roulette:create', bad)).ok).toBe(false);
      }
    });

    it('o servidor sorteia uma opção e avisa todo mundo; o resultado fica no histórico', async () => {
      const { ana, bruno, geral } = await threeInGeral();
      const message = ok(await ana.socket.emitWithAck('roulette:create', newRoulette(geral.id)));

      const toAna = nextEvent(ana.socket, 'roulette:spun', (e) => e.messageId === message.id);
      const toBruno = nextEvent(bruno.socket, 'roulette:spun', (e) => e.messageId === message.id);
      ok(await bruno.socket.emitWithAck('roulette:spin', { messageId: message.id }));
      const [a, b] = await Promise.all([toAna, toBruno]);

      expect(a).toEqual(b);
      expect(a.channelId).toBe(geral.id);
      expect(a.roulette.result).toBeGreaterThanOrEqual(0);
      expect(a.roulette.result).toBeLessThan(4);
      expect(a.roulette.spunById).toBe(bruno.user.id);
      expect(a.roulette.spunAt).toBeTruthy();

      const history = ok(await ana.socket.emitWithAck('channel:history', { channelId: geral.id }));
      expect(history.find((m) => m.id === message.id)!.roulette).toEqual(a.roulette);
    });

    it('só gira uma vez: depois do resultado, ninguém muda', async () => {
      const { ana, bruno, geral } = await threeInGeral();
      const message = ok(await ana.socket.emitWithAck('roulette:create', newRoulette(geral.id)));
      ok(await ana.socket.emitWithAck('roulette:spin', { messageId: message.id }));
      const before = (await server.db.roulette.findUniqueOrThrow({ where: { messageId: message.id } })).resultIndex;

      const again = nextEvent(ana.socket, 'roulette:spun', undefined, 400).then(() => 'chegou', () => 'nada');
      const res = await bruno.socket.emitWithAck('roulette:spin', { messageId: message.id });
      expect(res).toEqual({ ok: false, error: 'Esta roleta já foi girada.' });
      expect(await again).toBe('nada');
      expect((await server.db.roulette.findUniqueOrThrow({ where: { messageId: message.id } })).resultIndex).toBe(before);
    });

    it('duas pessoas girando ao mesmo tempo: um resultado só, igual para todo mundo', async () => {
      const { ana, bruno, carla, geral } = await threeInGeral();
      for (let round = 0; round < 5; round++) {
        const message = ok(await ana.socket.emitWithAck('roulette:create', newRoulette(geral.id)));
        const seen = nextEvent(carla.socket, 'roulette:spun', (e) => e.messageId === message.id);
        const results = await Promise.all([
          ana.socket.emitWithAck('roulette:spin', { messageId: message.id }),
          bruno.socket.emitWithAck('roulette:spin', { messageId: message.id }),
        ]);
        expect(results.filter((r) => r.ok)).toHaveLength(1);
        const row = await server.db.roulette.findUniqueOrThrow({ where: { messageId: message.id } });
        expect((await seen).roulette.result).toBe(row.resultIndex);
      }
    });

    it('sorteia de verdade: com duas opções, as duas saem', async () => {
      const { ana, geral } = await threeInGeral();
      const seen = new Set<number | null>();
      for (let i = 0; i < 24; i++) {
        const message = ok(await ana.socket.emitWithAck('roulette:create', { channelId: geral.id, options: ['cara', 'coroa'] }));
        ok(await ana.socket.emitWithAck('roulette:spin', { messageId: message.id }));
        seen.add((await server.db.roulette.findUniqueOrThrow({ where: { messageId: message.id } })).resultIndex);
      }
      expect([...seen].sort()).toEqual([0, 1]);
    });

    it('recusa girar o que não é roleta e o que a pessoa não pode ler', async () => {
      const ana = await server.connect('Ana');
      const bruno = await server.connect('Bruno');
      const carla = await server.connect('Carla');
      const dm = ok(await ana.socket.emitWithAck('dm:open', { userId: bruno.user.id }));
      const roulette = ok(await ana.socket.emitWithAck('roulette:create', newRoulette(dm.conversation.id)));
      const plain = ok(await ana.socket.emitWithAck('message:send', { channelId: dm.conversation.id, content: 'oi' }));

      expect((await carla.socket.emitWithAck('roulette:spin', { messageId: roulette.id })).ok).toBe(false);
      expect((await bruno.socket.emitWithAck('roulette:spin', { messageId: plain.id })).ok).toBe(false);
      expect((await bruno.socket.emitWithAck('roulette:spin', { messageId: 'nao-existe' })).ok).toBe(false);
      await expectNoEvent(bruno.socket, 'roulette:spun', 200);
      expect((await server.db.roulette.findUniqueOrThrow({ where: { messageId: roulette.id } })).resultIndex).toBeNull();
    });

    it('não dá para editar, e apagar a mensagem apaga a roleta', async () => {
      const { ana, geral } = await threeInGeral();
      const message = ok(await ana.socket.emitWithAck('roulette:create', newRoulette(geral.id)));
      expect((await ana.socket.emitWithAck('message:edit', { messageId: message.id, content: 'x' })).ok).toBe(false);
      ok(await ana.socket.emitWithAck('message:delete', { messageId: message.id }));
      expect(await server.db.roulette.count({ where: { messageId: message.id } })).toBe(0);
    });

    it('conta como mensagem nova para quem não está olhando', async () => {
      const { ana, bruno, geral } = await threeInGeral();
      const bump = nextEvent(bruno.socket, 'unread:bump', (p) => p.channelId === geral.id);
      ok(await ana.socket.emitWithAck('roulette:create', newRoulette(geral.id)));
      expect((await bump).channelId).toBe(geral.id);
    });
  });
});

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MAX_REACTION_KINDS } from '../../../shared/src/emoji.js';
import { hasTestDatabase } from '../support/database.js';
import { channelNamed, expectNoEvent, joinDemoSpace, nextEvent, ok, TestServer } from '../support/harness.js';

describe.skipIf(!hasTestDatabase)('respostas e reações', () => {
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

  describe('respostas', () => {
    it('guarda a resposta com um resumo da original, que vem no histórico e no evento', async () => {
      const { ana, bruno, geral } = await twoInGeral();
      const original = ok(await ana.socket.emitWithAck('message:send', { channelId: geral.id, content: 'quem vai\njogar hoje?' }));

      const received = nextEvent(ana.socket, 'message:new', (m) => m.authorId === bruno.user.id);
      const reply = ok(
        await bruno.socket.emitWithAck('message:send', { channelId: geral.id, content: 'eu vou', replyToId: original.id }),
      );
      expect(reply.replyTo).toEqual({
        id: original.id,
        deleted: false,
        authorId: ana.user.id,
        excerpt: 'quem vai jogar hoje?',
        hasAttachments: false,
      });
      expect((await received).replyTo?.id).toBe(original.id);

      const history = ok(await ana.socket.emitWithAck('channel:history', { channelId: geral.id }));
      expect(history.at(-1)?.replyTo?.excerpt).toBe('quem vai jogar hoje?');
      expect(history.find((m) => m.id === original.id)?.replyTo).toBeNull();
    });

    it('corta o resumo de uma mensagem longa', async () => {
      const { ana, bruno, geral } = await twoInGeral();
      const original = ok(await ana.socket.emitWithAck('message:send', { channelId: geral.id, content: 'a'.repeat(500) }));
      const reply = ok(await bruno.socket.emitWithAck('message:send', { channelId: geral.id, content: 'ok', replyToId: original.id }));
      expect(reply.replyTo?.excerpt).toHaveLength(100);
      expect(reply.replyTo?.excerpt.endsWith('…')).toBe(true);
    });

    it('depois que a original é apagada, a resposta continua e mostra que ela sumiu', async () => {
      const { ana, bruno, geral } = await twoInGeral();
      const original = ok(await ana.socket.emitWithAck('message:send', { channelId: geral.id, content: 'vou apagar' }));
      const reply = ok(await bruno.socket.emitWithAck('message:send', { channelId: geral.id, content: 'tarde demais', replyToId: original.id }));
      ok(await ana.socket.emitWithAck('message:delete', { messageId: original.id }));

      const history = ok(await bruno.socket.emitWithAck('channel:history', { channelId: geral.id }));
      expect(history.find((m) => m.id === reply.id)?.replyTo).toEqual({
        id: original.id,
        deleted: true,
        authorId: null,
        excerpt: '',
        hasAttachments: false,
      });
    });

    it('só responde a mensagens do mesmo canal, e que ainda existam', async () => {
      const { ana, bruno, geral } = await twoInGeral();
      const ajuda = channelNamed(await joinDemoSpace(ana), 'ajuda');
      const elsewhere = ok(await ana.socket.emitWithAck('message:send', { channelId: ajuda.id, content: 'em outro canal' }));
      const refused = { ok: false, error: 'A mensagem que você quer responder não existe mais.' };
      expect(await bruno.socket.emitWithAck('message:send', { channelId: geral.id, content: 'x', replyToId: elsewhere.id })).toEqual(refused);
      expect(await bruno.socket.emitWithAck('message:send', { channelId: geral.id, content: 'x', replyToId: 'nao-existe' })).toEqual(refused);
    });

    it('avisa quem foi respondido como numa menção, mas não a si mesmo', async () => {
      const { ana, bruno, geral } = await twoInGeral();
      const original = ok(await ana.socket.emitWithAck('message:send', { channelId: geral.id, content: 'oi' }));

      const mention = nextEvent(ana.socket, 'mentions:update', (m) => m.channelId === geral.id);
      ok(await bruno.socket.emitWithAck('message:send', { channelId: geral.id, content: 'oi, Ana', replyToId: original.id }));
      expect((await mention).count).toBe(1);

      // Responder a si mesma não gera aviso.
      const none = expectNoEvent(ana.socket, 'mentions:update');
      ok(await ana.socket.emitWithAck('message:send', { channelId: geral.id, content: 'eu mesma', replyToId: original.id }));
      await none;
    });

    it('também vale nas conversas diretas', async () => {
      const ana = await server.connect('Ana');
      const bruno = await server.connect('Bruno');
      const { conversation } = ok(await ana.socket.emitWithAck('dm:open', { userId: bruno.user.id }));
      const first = ok(await ana.socket.emitWithAck('message:send', { channelId: conversation.id, content: 'oi, Bruno' }));
      const reply = ok(await bruno.socket.emitWithAck('message:send', { channelId: conversation.id, content: 'oi!', replyToId: first.id }));
      expect(reply.replyTo?.authorId).toBe(ana.user.id);
    });
  });

  describe('reações', () => {
    it('reage, mostra para todos no canal e tira ao reagir de novo', async () => {
      const { ana, bruno, geral } = await twoInGeral();
      const message = ok(await ana.socket.emitWithAck('message:send', { channelId: geral.id, content: 'novidade' }));
      expect(message.reactions).toEqual([]);

      let seen = nextEvent(ana.socket, 'message:reactions', (r) => r.messageId === message.id);
      ok(await bruno.socket.emitWithAck('reaction:toggle', { messageId: message.id, emoji: '👍' }));
      expect((await seen).reactions).toEqual([{ emoji: '👍', userIds: [bruno.user.id] }]);

      seen = nextEvent(bruno.socket, 'message:reactions', (r) => r.reactions.length === 1 && r.reactions[0].userIds.length === 2);
      ok(await ana.socket.emitWithAck('reaction:toggle', { messageId: message.id, emoji: '👍' }));
      expect((await seen).reactions).toEqual([{ emoji: '👍', userIds: [bruno.user.id, ana.user.id] }]);

      // A ordem dos emojis é a da primeira vez que cada um apareceu.
      ok(await ana.socket.emitWithAck('reaction:toggle', { messageId: message.id, emoji: '🎉' }));
      const history = ok(await ana.socket.emitWithAck('channel:history', { channelId: geral.id }));
      expect(history.at(-1)?.reactions.map((r) => r.emoji)).toEqual(['👍', '🎉']);

      seen = nextEvent(ana.socket, 'message:reactions', (r) => r.reactions.length === 1);
      ok(await ana.socket.emitWithAck('reaction:toggle', { messageId: message.id, emoji: '🎉' }));
      expect((await seen).reactions.map((r) => r.emoji)).toEqual(['👍']);

      seen = nextEvent(ana.socket, 'message:reactions', (r) => r.reactions.length === 1 && r.reactions[0].userIds.length === 1);
      ok(await ana.socket.emitWithAck('reaction:toggle', { messageId: message.id, emoji: '👍' }));
      expect((await seen).reactions).toEqual([{ emoji: '👍', userIds: [bruno.user.id] }]);
    });

    it('as reações somem junto com a mensagem', async () => {
      const { ana, geral } = await twoInGeral();
      const message = ok(await ana.socket.emitWithAck('message:send', { channelId: geral.id, content: 'temporária' }));
      ok(await ana.socket.emitWithAck('reaction:toggle', { messageId: message.id, emoji: '🔥' }));
      ok(await ana.socket.emitWithAck('message:delete', { messageId: message.id }));
      expect((await ana.socket.emitWithAck('reaction:toggle', { messageId: message.id, emoji: '🔥' })).ok).toBe(false);
    });

    it('só aceita um emoji de verdade', async () => {
      const { ana, geral } = await twoInGeral();
      const message = ok(await ana.socket.emitWithAck('message:send', { channelId: geral.id, content: 'oi' }));
      for (const emoji of ['a', '', 'oi', '👍👍', '<script>', 'x'.repeat(40), 42 as unknown as string]) {
        expect(await ana.socket.emitWithAck('reaction:toggle', { messageId: message.id, emoji })).toEqual({
          ok: false,
          error: 'Esse emoji não vale como reação.',
        });
      }
      // Emojis compostos valem: bandeira, tom de pele e família (com junção).
      for (const emoji of ['🇧🇷', '👍🏽', '👨‍👩‍👧', '❤️', '1️⃣']) {
        ok(await ana.socket.emitWithAck('reaction:toggle', { messageId: message.id, emoji }));
      }
    });

    it('limita quantos emojis diferentes cabem numa mensagem, sem travar quem já reagiu', async () => {
      const { ana, bruno, geral } = await twoInGeral();
      const message = ok(await ana.socket.emitWithAck('message:send', { channelId: geral.id, content: 'enfeitada' }));
      const emojis = ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙'];
      expect(emojis).toHaveLength(MAX_REACTION_KINDS);
      for (const emoji of emojis) ok(await ana.socket.emitWithAck('reaction:toggle', { messageId: message.id, emoji }));

      const full = await bruno.socket.emitWithAck('reaction:toggle', { messageId: message.id, emoji: '🥲' });
      expect(full.ok).toBe(false);
      // Reagir com um que já existe continua valendo.
      ok(await bruno.socket.emitWithAck('reaction:toggle', { messageId: message.id, emoji: '😀' }));
    });

    it('quem não pode ler o canal não reage', async () => {
      const ana = await server.connect('Ana');
      const bruno = await server.connect('Bruno');
      const snapshot = await joinDemoSpace(ana);
      const message = ok(await ana.socket.emitWithAck('message:send', { channelId: channelNamed(snapshot, 'geral').id, content: 'oi' }));
      // Bruno ainda nem abriu o espaço, mas todo espaço é público; já uma conversa direta alheia é privada.
      const other = await server.connect('Carla');
      const dm = ok(await ana.socket.emitWithAck('dm:open', { userId: other.user.id }));
      const secret = ok(await ana.socket.emitWithAck('message:send', { channelId: dm.conversation.id, content: 'segredo' }));
      expect((await bruno.socket.emitWithAck('reaction:toggle', { messageId: secret.id, emoji: '👀' })).ok).toBe(false);
      expect((await bruno.socket.emitWithAck('reaction:toggle', { messageId: 'nao-existe', emoji: '👀' })).ok).toBe(false);
      ok(await other.socket.emitWithAck('reaction:toggle', { messageId: secret.id, emoji: '👀' }));
      expect(message.reactions).toEqual([]);
    });

    it('as reações continuam depois de reiniciar o servidor', async () => {
      const { ana, geral } = await twoInGeral();
      const message = ok(await ana.socket.emitWithAck('message:send', { channelId: geral.id, content: 'fica' }));
      ok(await ana.socket.emitWithAck('reaction:toggle', { messageId: message.id, emoji: '⭐' }));
      await server.restart();
      const again = await server.connectWithToken(ana.token);
      await joinDemoSpace(again);
      const history = ok(await again.socket.emitWithAck('channel:history', { channelId: geral.id }));
      expect(history.find((m) => m.id === message.id)?.reactions).toEqual([{ emoji: '⭐', userIds: [ana.user.id] }]);
    });
  });
});

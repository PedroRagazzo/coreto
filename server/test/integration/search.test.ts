import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Id } from '../../../shared/src/models.js';
import { searchKey } from '../../../shared/src/search.js';
import { hasTestDatabase } from '../support/database.js';
import { channelNamed, fakePng, joinDemoSpace, ok, TestServer, type TestClient } from '../support/harness.js';

describe.skipIf(!hasTestDatabase)('busca de mensagens', () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await TestServer.start();
  });
  afterEach(() => server.disconnectAll());
  afterAll(() => server?.stop());

  /** Espaço novo, só com as mensagens do teste. */
  async function freshSpace(owner: TestClient, name: string) {
    const space = ok(await owner.socket.emitWithAck('space:create', { name }));
    const snapshot = ok(await owner.socket.emitWithAck('space:join', space.id));
    return { space, geral: channelNamed(snapshot, 'geral') };
  }
  const send = async (client: TestClient, channelId: Id, content: string) =>
    ok(await client.socket.emitWithAck('message:send', { channelId, content }));

  it('ignora acentos e maiúsculas, exige todas as palavras e traz as mais recentes primeiro', async () => {
    const ana = await server.connect('Ana');
    const { space, geral } = await freshSpace(ana, 'Busca 1');
    await send(ana, geral.id, 'Reunião de ORGANIZAÇÃO amanhã');
    await send(ana, geral.id, 'organizacao da festa');
    await send(ana, geral.id, 'nada a ver');

    const res = ok(await ana.socket.emitWithAck('message:search', { scope: { spaceId: space.id }, text: 'Organização' }));
    expect(res.total).toBe(2);
    expect(res.messages.map((m) => m.content)).toEqual(['organizacao da festa', 'Reunião de ORGANIZAÇÃO amanhã']);

    const both = ok(await ana.socket.emitWithAck('message:search', { scope: { spaceId: space.id }, text: 'reuniao organizacao' }));
    expect(both.messages.map((m) => m.content)).toEqual(['Reunião de ORGANIZAÇÃO amanhã']);
  });

  it('pagina para trás com `before`', async () => {
    const ana = await server.connect('Ana');
    const { space, geral } = await freshSpace(ana, 'Busca 2');
    for (let i = 1; i <= 30; i++) await send(ana, geral.id, `item ${i}`);

    const first = ok(await ana.socket.emitWithAck('message:search', { scope: { spaceId: space.id }, text: 'item' }));
    expect(first.total).toBe(30);
    expect(first.messages).toHaveLength(25);
    const next = ok(
      await ana.socket.emitWithAck('message:search', {
        scope: { spaceId: space.id },
        text: 'item',
        before: first.messages.at(-1)!.id,
      }),
    );
    expect(next.messages.map((m) => m.content)).toEqual(['item 5', 'item 4', 'item 3', 'item 2', 'item 1']);
  });

  it('filtra por autor, canal, imagem e link', async () => {
    const ana = await server.connect('Ana');
    const bruno = await server.connect('Bruno');
    const { space, geral } = await freshSpace(ana, 'Busca 3');
    const outro = ok(await ana.socket.emitWithAck('channel:create', { spaceId: space.id, categoryId: null, name: 'outro', kind: 'text' })).channel;
    ok(await bruno.socket.emitWithAck('space:join', space.id));

    await send(ana, geral.id, 'bolo da ana');
    await send(bruno, geral.id, 'bolo do bruno');
    await send(ana, outro.id, 'bolo no outro canal veja https://receitas.exemplo/bolo');
    const upload = await server.upload(ana.token, fakePng(10, 10));
    if (!upload.body.ok) throw new Error(upload.body.error);
    ok(await ana.socket.emitWithAck('message:send', { channelId: geral.id, content: 'foto do bolo', attachmentIds: [upload.body.attachment.id] }));

    const search = async (extra: object) =>
      ok(await ana.socket.emitWithAck('message:search', { scope: { spaceId: space.id }, text: 'bolo', ...extra })).messages.map(
        (m) => m.content,
      );
    expect(await search({ authorId: bruno.user.id })).toEqual(['bolo do bruno']);
    expect(await search({ channelId: outro.id })).toEqual(['bolo no outro canal veja https://receitas.exemplo/bolo']);
    expect(await search({ has: 'image' })).toEqual(['foto do bolo']);
    expect(await search({ has: 'link' })).toEqual(['bolo no outro canal veja https://receitas.exemplo/bolo']);
    // Só filtro, sem texto, também vale.
    const onlyAuthor = ok(await ana.socket.emitWithAck('message:search', { scope: { spaceId: space.id }, authorId: bruno.user.id }));
    expect(onlyAuthor.total).toBe(1);
  });

  it('não encontra o que a pessoa não pode ler', async () => {
    const ana = await server.connect('Ana');
    const snapshot = await joinDemoSpace(ana);
    const hidden = await server.db.channel.findFirstOrThrow({ where: { name: 'moderação' } });
    const content = 'segredo da moderacao';
    await server.db.message.create({ data: { channelId: hidden.id, authorId: ana.user.id, content, searchText: searchKey(content) } });

    const res = ok(await ana.socket.emitWithAck('message:search', { scope: { spaceId: snapshot.space.id }, text: 'segredo' }));
    expect(res.total).toBe(0);
    // Pedir o canal escondido pelo id também não ajuda.
    const direct = ok(
      await ana.socket.emitWithAck('message:search', { scope: { spaceId: snapshot.space.id }, channelId: hidden.id, text: 'segredo' }),
    );
    expect(direct.total).toBe(0);
  });

  it('busca numa conversa direta só para quem participa dela', async () => {
    const ana = await server.connect('Ana');
    const bruno = await server.connect('Bruno');
    const carla = await server.connect('Carla');
    const { conversation } = ok(await ana.socket.emitWithAck('dm:open', { userId: bruno.user.id }));
    await send(ana, conversation.id, 'senha do wifi é coreto123');

    const found = ok(await bruno.socket.emitWithAck('message:search', { scope: { directId: conversation.id }, text: 'wifi' }));
    expect(found.total).toBe(1);
    expect((await carla.socket.emitWithAck('message:search', { scope: { directId: conversation.id }, text: 'wifi' })).ok).toBe(false);
  });

  it('acompanha a edição, ignora ids de menção e recusa busca vazia', async () => {
    const ana = await server.connect('Ana');
    const bruno = await server.connect('Bruno');
    const { space, geral } = await freshSpace(ana, 'Busca 4');
    const sent = await send(ana, geral.id, `<@${bruno.user.id}> versão antiga`);
    ok(await ana.socket.emitWithAck('message:edit', { messageId: sent.id, content: `<@${bruno.user.id}> versão nova` }));

    const search = async (text: string) =>
      ok(await ana.socket.emitWithAck('message:search', { scope: { spaceId: space.id }, text })).total;
    expect(await search('antiga')).toBe(0);
    expect(await search('nova')).toBe(1);
    expect(await search(bruno.user.id.slice(0, 8))).toBe(0);
    expect((await ana.socket.emitWithAck('message:search', { scope: { spaceId: space.id }, text: '   ' })).ok).toBe(false);
  });

  it('trata % e _ como texto, não como curinga', async () => {
    const ana = await server.connect('Ana');
    const { space, geral } = await freshSpace(ana, 'Busca 5');
    await send(ana, geral.id, '50 reais');
    await send(ana, geral.id, 'desconto de 50%');
    await send(ana, geral.id, 'nome_de_arquivo');
    await send(ana, geral.id, 'nomeXdeXarquivo');
    const search = async (text: string) =>
      ok(await ana.socket.emitWithAck('message:search', { scope: { spaceId: space.id }, text })).messages.map((m) => m.content);
    expect(await search('50%')).toEqual(['desconto de 50%']);
    expect(await search('nome_de')).toEqual(['nome_de_arquivo']);
  });
});

describe.skipIf(!hasTestDatabase)('histórico em volta de uma mensagem', () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await TestServer.start();
  });
  afterEach(() => server.disconnectAll());
  afterAll(() => server?.stop());

  it('devolve as vizinhas e diz se o histórico continua, e `after` anda para frente', async () => {
    const ana = await server.connect('Ana');
    const space = ok(await ana.socket.emitWithAck('space:create', { name: 'Contexto' }));
    const geral = channelNamed(ok(await ana.socket.emitWithAck('space:join', space.id)), 'geral');
    const sent = [];
    for (let i = 1; i <= 80; i++) sent.push(ok(await ana.socket.emitWithAck('message:send', { channelId: geral.id, content: `m${i}` })));

    const middle = ok(await ana.socket.emitWithAck('message:context', { messageId: sent[39].id }));
    expect(middle.channelId).toBe(geral.id);
    expect(middle.messages.map((m) => m.content)).toEqual(Array.from({ length: 51 }, (_, i) => `m${i + 15}`));
    expect([middle.reachedStart, middle.reachedEnd]).toEqual([false, false]);

    const early = ok(await ana.socket.emitWithAck('message:context', { messageId: sent[2].id }));
    expect(early.messages[0].content).toBe('m1');
    expect(early.reachedStart).toBe(true);

    const after = ok(await ana.socket.emitWithAck('channel:history', { channelId: geral.id, after: sent[74].id, limit: 10 }));
    expect(after.map((m) => m.content)).toEqual(['m76', 'm77', 'm78', 'm79', 'm80']);
  });

  it('não mostra o contexto de mensagens que a pessoa não pode ler', async () => {
    const ana = await server.connect('Ana');
    const bruno = await server.connect('Bruno');
    const { conversation } = ok(await ana.socket.emitWithAck('dm:open', { userId: bruno.user.id }));
    const sent = ok(await ana.socket.emitWithAck('message:send', { channelId: conversation.id, content: 'só nós' }));
    const carla = await server.connect('Carla');
    expect((await carla.socket.emitWithAck('message:context', { messageId: sent.id })).ok).toBe(false);
  });
});

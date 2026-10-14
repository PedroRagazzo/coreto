import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { SpaceSnapshot } from '../../../shared/src/models.js';
import { Permission } from '../../../shared/src/permissions.js';
import { hasTestDatabase } from '../support/database.js';
import { channelNamed, expectNoEvent, nextEvent, ok, TestServer, type TestClient } from '../support/harness.js';

describe.skipIf(!hasTestDatabase)('gestão de espaços e canais', () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await TestServer.start();
  });
  afterEach(() => server.disconnectAll());
  afterAll(() => server?.stop());

  /** Ana cria um espaço (vira dona) e Bruno, membro comum, abre ele também. */
  async function spaceWithMember(name = 'Turma A') {
    const ana = await server.connect('Ana');
    const bruno = await server.connect('Bruno');
    const space = ok(await ana.socket.emitWithAck('space:create', { name }));
    const snapshot = ok(await ana.socket.emitWithAck('space:join', space.id));
    ok(await bruno.socket.emitWithAck('space:join', space.id));
    return { ana, bruno, space, snapshot };
  }

  const category = (snapshot: SpaceSnapshot, name: string) => snapshot.categories.find((c) => c.name === name)!;

  it('cria um espaço com dono, canais padrão e todos como membros', async () => {
    const ana = await server.connect('Ana');
    const bruno = await server.connect('Bruno');
    const announced = nextEvent(bruno.socket, 'space:created');

    const space = ok(await ana.socket.emitWithAck('space:create', { name: '  Turma   B ' }));
    expect(space).toMatchObject({ name: 'Turma B', ownerId: ana.user.id });
    expect((await announced).id).toBe(space.id);

    const snapshot = ok(await bruno.socket.emitWithAck('space:join', space.id));
    expect(snapshot.channels.map((c) => `${c.kind}:${c.name}`).sort()).toEqual(['text:geral', 'voice:Geral']);
    expect(snapshot.members.map((m) => m.userId)).toEqual(expect.arrayContaining([ana.user.id, bruno.user.id]));
    expect((await ana.socket.emitWithAck('space:create', { name: '   ' })).ok).toBe(false);
  });

  it('só deixa criar canal com MANAGE_CHANNELS e normaliza o nome', async () => {
    const { ana, bruno, space, snapshot } = await spaceWithMember();
    const texto = category(snapshot, 'Canais de texto');
    const request = { spaceId: space.id, categoryId: texto.id, name: 'Dúvidas Gerais!', kind: 'text' as const };

    expect((await bruno.socket.emitWithAck('channel:create', request)).ok).toBe(false);

    const announced = nextEvent(bruno.socket, 'channel:created');
    const { channel } = ok(await ana.socket.emitWithAck('channel:create', request));
    expect(channel).toMatchObject({ name: 'dúvidas-gerais', categoryId: texto.id, position: 1 });
    expect((await announced).channel.id).toBe(channel.id);

    // Quem pode ver o canal novo já recebe as mensagens dele.
    const message = nextEvent(bruno.socket, 'message:new');
    ok(await ana.socket.emitWithAck('message:send', { channelId: channel.id, content: 'primeira' }));
    expect((await message).channelId).toBe(channel.id);
  });

  it('edita nome, tópico e categoria do canal e avisa quem está no espaço', async () => {
    const { ana, bruno, snapshot } = await spaceWithMember();
    const geral = channelNamed(snapshot, 'geral');
    const voz = category(snapshot, 'Canais de voz');

    expect((await bruno.socket.emitWithAck('channel:update', { channelId: geral.id, name: 'hack' })).ok).toBe(false);

    const announced = nextEvent(bruno.socket, 'channel:updated');
    const updated = ok(
      await ana.socket.emitWithAck('channel:update', {
        channelId: geral.id,
        name: 'Bate Papo',
        topic: '  Conversa livre  ',
        categoryId: voz.id,
      }),
    );
    // Ao mudar de categoria, o canal vai para o fim dela (depois da sala "Geral").
    expect(updated).toMatchObject({ name: 'bate-papo', topic: 'Conversa livre', categoryId: voz.id, position: 1 });
    expect(await announced).toEqual(updated);

    const cleared = ok(await ana.socket.emitWithAck('channel:update', { channelId: geral.id, topic: '' }));
    expect(cleared.topic).toBeNull();
  });

  it('exclui o canal com as mensagens e desconecta quem estava na sala de voz', async () => {
    const { ana, bruno, snapshot } = await spaceWithMember();
    const geral = channelNamed(snapshot, 'geral');
    const sala = channelNamed(snapshot, 'Geral');
    ok(await bruno.socket.emitWithAck('message:send', { channelId: geral.id, content: 'vai sumir' }));
    ok(await bruno.socket.emitWithAck('voice:join', { channelId: sala.id }));

    expect((await bruno.socket.emitWithAck('channel:delete', { channelId: geral.id })).ok).toBe(false);

    const kicked = nextEvent(bruno.socket, 'voice:ended');
    ok(await ana.socket.emitWithAck('channel:delete', { channelId: sala.id }));
    expect((await kicked).reason).toMatch(/excluído/);

    const gone = nextEvent(bruno.socket, 'channel:deleted', (p) => p.channelId === geral.id);
    ok(await ana.socket.emitWithAck('channel:delete', { channelId: geral.id }));
    await gone;
    expect(await server.db.message.count({ where: { channelId: geral.id } })).toBe(0);
    expect((await bruno.socket.emitWithAck('channel:history', { channelId: geral.id })).ok).toBe(false);
  });

  it('só administradores renomeiam e só o dono exclui o espaço, que some com tudo', async () => {
    const { ana, bruno, space } = await spaceWithMember('Para apagar');

    expect((await bruno.socket.emitWithAck('space:update', { spaceId: space.id, name: 'hack' })).ok).toBe(false);
    expect((await bruno.socket.emitWithAck('space:delete', { spaceId: space.id })).ok).toBe(false);

    const renamed = nextEvent(bruno.socket, 'space:updated');
    ok(await ana.socket.emitWithAck('space:update', { spaceId: space.id, name: 'Novo nome' }));
    expect((await renamed).name).toBe('Novo nome');

    const deleted = nextEvent(bruno.socket, 'space:deleted');
    ok(await ana.socket.emitWithAck('space:delete', { spaceId: space.id }));
    expect((await deleted).spaceId).toBe(space.id);

    expect((await bruno.socket.emitWithAck('space:join', space.id)).ok).toBe(false);
    const where = { spaceId: space.id };
    expect(await server.db.channel.count({ where })).toBe(0);
    expect(await server.db.member.count({ where })).toBe(0);
    expect(await server.db.role.count({ where })).toBe(0);
  });

  it('não envia o canal novo a quem não pode vê-lo', async () => {
    // Bruno não pode ver um canal se @everyone perder VIEW_CHANNEL nele. Sem interface
    // para sobrescritas, o teste ajusta pelo banco e reinicia para o servidor recarregar.
    const { ana, space, snapshot } = await spaceWithMember();
    const texto = category(snapshot, 'Canais de texto');
    const { channel } = ok(
      await ana.socket.emitWithAck('channel:create', { spaceId: space.id, categoryId: texto.id, name: 'equipe', kind: 'text' }),
    );
    await server.db.permissionOverwrite.create({
      data: { channelId: channel.id, targetType: 'ROLE', targetId: space.id, deny: BigInt(Permission.VIEW_CHANNEL) },
    });
    await server.restart();

    const dona = await server.connectWithToken(ana.token);
    const membro: TestClient = await server.connect('Bruno');
    ok(await dona.socket.emitWithAck('space:join', space.id));
    const visible = ok(await membro.socket.emitWithAck('space:join', space.id));
    expect(visible.channels.map((c) => c.name)).not.toContain('equipe');

    const silence = expectNoEvent(membro.socket, 'channel:updated');
    ok(await dona.socket.emitWithAck('channel:update', { channelId: channel.id, topic: 'só para a equipe' }));
    await silence;
  });
});

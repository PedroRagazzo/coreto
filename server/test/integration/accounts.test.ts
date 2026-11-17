import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDatabase } from '../support/database.js';
import { channelNamed, expectNoEvent, fakePng, joinDemoSpace, nextEvent, ok, TestServer } from '../support/harness.js';

describe.skipIf(!hasTestDatabase)('exclusão de contas', () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await TestServer.start();
  });
  afterEach(() => server.disconnectAll());
  afterAll(() => server?.stop());

  it('só o administrador geral exclui contas', async () => {
    const ana = await server.connect('Ana');
    const bruno = await server.connect('Bruno');
    const res = await ana.socket.emitWithAck('account:delete', { userId: bruno.user.id });
    expect(res.ok).toBe(false);
    expect(await server.db.user.findUnique({ where: { id: bruno.user.id } })).not.toBeNull();
  });

  it('o administrador exclui a conta com as mensagens e os anexos, e a pessoa não volta', async () => {
    const admin = await server.connect('Admin');
    const bruno = await server.connect('Bruno');
    const carla = await server.connect('Carla');
    server.makeSuperAdmin(admin.user.displayName);
    const geral = channelNamed(await joinDemoSpace(bruno), 'geral');
    await joinDemoSpace(carla);

    // O que o Bruno deixou: uma mensagem com anexo, e um espaço dele.
    const up = await server.upload(bruno.token, fakePng(40, 30), 'foto.png');
    if (!up.body.ok) throw new Error('upload recusado');
    const attachment = up.body.attachment;
    const sent = ok(
      await bruno.socket.emitWithAck('message:send', { channelId: geral.id, content: 'oi, sou o Bruno', attachmentIds: [attachment.id] }),
    );
    const space = ok(await bruno.socket.emitWithAck('space:create', { name: 'Espaço do Bruno' }));
    expect(existsSync(join(server.uploadDir, attachment.id))).toBe(true);

    const announced = nextEvent(carla.socket, 'account:deleted');
    ok(await admin.socket.emitWithAck('account:delete', { userId: bruno.user.id }));
    expect(await announced).toEqual({ userId: bruno.user.id });

    // A conta, a mensagem e o arquivo sumiram; o espaço dele ficou com quem excluiu.
    expect(await server.db.user.findUnique({ where: { id: bruno.user.id } })).toBeNull();
    expect(await server.db.message.findUnique({ where: { id: sent.id } })).toBeNull();
    expect((await server.db.space.findUnique({ where: { id: space.id } }))?.ownerId).toBe(admin.user.id);
    await expect.poll(() => existsSync(join(server.uploadDir, attachment.id))).toBe(false);
    const history = ok(await carla.socket.emitWithAck('channel:history', { channelId: geral.id }));
    expect(history.some((m) => m.id === sent.id)).toBe(false);

    // A sessão dele acabou: o token antigo não vale mais, e o nome fica livre.
    expect((await server.upload(bruno.token, fakePng(10, 10))).status).toBe(401);
    expect(await server.db.user.count({ where: { loginName: bruno.user.displayName.toLocaleLowerCase('pt-BR') } })).toBe(0);
  });

  it('recusa excluir a si mesmo, um robô e outro administrador geral', async () => {
    const admin = await server.connect('Admin');
    const outro = await server.connect('Outro');
    const snapshot = await joinDemoSpace(admin);
    const bot = snapshot.users.find((u) => u.isBot)!;
    server.makeSuperAdmin(admin.user.displayName, outro.user.displayName);

    const silence = expectNoEvent(outro.socket, 'account:deleted');
    for (const userId of [admin.user.id, bot.id, outro.user.id, 'conta-que-nao-existe']) {
      const res = await admin.socket.emitWithAck('account:delete', { userId });
      expect(res.ok).toBe(false);
    }
    await silence;
    expect(await server.db.user.count({ where: { id: { in: [admin.user.id, bot.id, outro.user.id] } } })).toBe(3);
  });

  it('avisa na sessão quem é administrador geral', async () => {
    const admin = await server.connect('Admin');
    server.makeSuperAdmin(admin.user.displayName);
    const again = await server.connectWithToken(admin.token);
    expect(again.superAdmin).toBe(true);
    const ana = await server.connect('Ana');
    expect(ana.superAdmin).toBe(false);
  });
});

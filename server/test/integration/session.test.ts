import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { hashToken } from '../../src/db/client.js';
import { hasTestDatabase } from '../support/database.js';
import { DEFAULT_PIN, joinDemoSpace, nextEvent, TestServer } from '../support/harness.js';

describe.skipIf(!hasTestDatabase)('login, sessão e presença', () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await TestServer.start();
  });
  afterEach(() => server.disconnectAll());
  afterAll(() => server?.stop());

  it('cria a conta no primeiro login e entra nela de novo com o mesmo nome e PIN', async () => {
    const first = await server.login('  Marina   Souza ', '4321');
    expect(first.status).toBe(200);
    if (!first.body.ok) throw new Error(first.body.error);
    expect(first.body.created).toBe(true);
    expect(first.body.user.displayName).toBe('Marina Souza');

    // Maiúsculas e espaços não importam: é a mesma conta, com uma sessão nova.
    const again = await server.login('MARINA souza', '4321');
    if (!again.body.ok) throw new Error(again.body.error);
    expect(again.body.created).toBe(false);
    expect(again.body.user.id).toBe(first.body.user.id);
    expect(again.body.token).not.toBe(first.body.token);
  });

  it('recusa PIN errado, nome vazio e PIN fora do formato', async () => {
    await server.login('Otávio', '1111');
    expect(await server.login('Otávio', '2222')).toMatchObject({ status: 401, body: { ok: false, code: 'wrong_pin' } });
    expect(await server.login('   ', '1111')).toMatchObject({ status: 400, body: { code: 'invalid_input' } });
    for (const pin of ['123', '12345', 'abcd', '']) {
      expect(await server.login('Otávio', pin)).toMatchObject({ status: 400, body: { code: 'invalid_input' } });
    }
  });

  it('reserva o nome do robô', async () => {
    expect(await server.login('coreto', '1234')).toMatchObject({ status: 403, body: { code: 'reserved_name' } });
  });

  it('bloqueia o nome depois de 5 PINs errados, mesmo com o PIN certo', async () => {
    await server.login('Paula', '1234');
    for (let i = 0; i < 5; i++) expect((await server.login('Paula', '9999')).status).toBe(401);
    const locked = await server.login('Paula', '1234');
    expect(locked).toMatchObject({ status: 429, body: { code: 'locked' } });
    // Outros nomes continuam entrando normalmente.
    expect((await server.login('Quitéria', '1234')).status).toBe(200);
  });

  it('mantém a pessoa logada: o token continua valendo depois de reiniciar o servidor', async () => {
    const ana = await server.connect('Ana');
    await server.restart();
    const again = await server.connectWithToken(ana.token);
    expect(again.user.id).toBe(ana.user.id);
  });

  it('recusa conexão com token inválido, avisando que a sessão não existe', async () => {
    await expect(server.connectWithToken('token-que-nunca-existiu-0000')).rejects.toMatchObject({
      message: 'Sessão inválida. Entre de novo.',
      data: { code: 'invalid_session' },
    });
    await expect(server.connectWithToken('curto')).rejects.toMatchObject({ data: { code: 'invalid_session' } });
  });

  it('continua aceitando as sessões de contas antigas, de antes do PIN', async () => {
    const legacyToken = 'token-de-uma-conta-antiga-sem-pin';
    const legacy = await server.db.user.create({
      data: { displayName: 'Conta antiga', avatarColor: '#5b8def', sessions: { create: { tokenHash: hashToken(legacyToken) } } },
    });
    await server.restart(); // o servidor só conhece usuários carregados do banco
    const client = await server.connectWithToken(legacyToken);
    expect(client.user.id).toBe(legacy.id);
  });

  it('faz quem chega virar membro dos espaços públicos e avisa quem já está lá', async () => {
    const ana = await server.connect('Ana');
    await joinDemoSpace(ana);
    const joined = nextEvent(ana.socket, 'member:joined', (p) => p.user.displayName.startsWith('Bruno'));
    const bruno = await server.connect('Bruno');
    expect(bruno.spaces.map((s) => s.name).sort()).toEqual(['Clube do Livro', 'Coreto Dev']);
    expect((await joined).member.userId).toBe(bruno.user.id);
  });

  it('avisa quando alguém fica online, muda de status e sai', async () => {
    const ana = await server.connect('Ana');
    await joinDemoSpace(ana);
    const online = nextEvent(ana.socket, 'presence:update', (p) => p.status === 'online');
    const bruno = await server.connect('Bruno');
    expect((await online).userId).toBe(bruno.user.id);

    const idle = nextEvent(ana.socket, 'presence:update', (p) => p.userId === bruno.user.id && p.status === 'idle');
    bruno.socket.emit('presence:set', 'idle');
    await idle;

    const offline = nextEvent(ana.socket, 'presence:update', (p) => p.userId === bruno.user.id && p.status === 'offline');
    bruno.socket.disconnect();
    await offline;
  });

  it('conta várias abas como uma presença só', async () => {
    const ana = await server.connect('Ana');
    await joinDemoSpace(ana);
    const firstTab = await server.connect('Bruno');
    await server.connectWithToken(firstTab.token);

    let wentOffline = false;
    ana.socket.on('presence:update', (p) => {
      if (p.userId === firstTab.user.id && p.status === 'offline') wentOffline = true;
    });
    firstTab.socket.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(wentOffline).toBe(false);
  });

  it('o PIN padrão dos testes cria contas novas a cada chamada', async () => {
    const a = await server.connect('Igual');
    const b = await server.connect('Igual');
    expect(a.user.id).not.toBe(b.user.id);
    expect(DEFAULT_PIN).toMatch(/^\d{4}$/);
  });
});

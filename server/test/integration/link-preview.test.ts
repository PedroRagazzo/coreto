import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createEmbeds } from '../../src/embeds/service.js';
import { hasTestDatabase } from '../support/database.js';
import { channelNamed, joinDemoSpace, ok, TestServer } from '../support/harness.js';
import { TINY_PNG, WebFixture } from '../support/web-fixture.js';

describe.skipIf(!hasTestDatabase)('pré-visualização de links', () => {
  let server: TestServer;
  let site: WebFixture;
  beforeAll(async () => {
    site = await WebFixture.start();
    // Os testes buscam num "site" da própria máquina, que o serviço de verdade recusaria.
    server = await TestServer.start({ embeds: createEmbeds({ allowPrivate: true }) });
  });
  afterEach(() => server.disconnectAll());
  afterAll(async () => {
    await server?.stop();
    await site.stop();
  });

  async function postedIn(content: string) {
    const ana = await server.connect('Ana');
    const geral = channelNamed(await joinDemoSpace(ana), 'geral');
    const message = ok(await ana.socket.emitWithAck('message:send', { channelId: geral.id, content }));
    return { ana, geral, message };
  }

  it('devolve o cartão do primeiro link da mensagem, e a imagem sai pelo servidor', async () => {
    const link = site.url('/pagina');
    const { ana, message } = await postedIn(`olha isso ${link}, e também ${site.url('/texto')}`);
    const preview = ok(await ana.socket.emitWithAck('link:preview', { messageId: message.id, url: link }));
    expect(preview).toMatchObject({ url: link, kind: 'page', title: 'Um "título" & tanto', siteName: 'Site de Teste' });

    const res = await fetch(`${server.url}/embed-image/${preview!.image!.id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(Buffer.from(await res.arrayBuffer()).equals(TINY_PNG)).toBe(true);
  });

  it('só busca o primeiro link, exatamente como está escrito na mensagem', async () => {
    const first = site.url('/pagina');
    const second = site.url('/vazia');
    const { ana, message } = await postedIn(`${first} e depois ${second}`);
    const before = site.hits.length;
    // O segundo link da mensagem e um endereço que nem está nela são recusados sem visitar ninguém.
    expect(ok(await ana.socket.emitWithAck('link:preview', { messageId: message.id, url: second }))).toBeNull();
    expect(ok(await ana.socket.emitWithAck('link:preview', { messageId: message.id, url: site.url('/svg') }))).toBeNull();
    expect(ok(await ana.socket.emitWithAck('link:preview', { messageId: 'nao-existe', url: first }))).toBeNull();
    expect(site.hits.length).toBe(before);
  });

  it('não serve de atalho para ler mensagens de conversas alheias', async () => {
    const ana = await server.connect('Ana');
    const bruno = await server.connect('Bruno');
    const carla = await server.connect('Carla');
    const dm = ok(await ana.socket.emitWithAck('dm:open', { userId: bruno.user.id }));
    const link = site.url('/pagina');
    const secret = ok(await ana.socket.emitWithAck('message:send', { channelId: dm.conversation.id, content: link }));
    const before = site.hits.length;
    expect(ok(await carla.socket.emitWithAck('link:preview', { messageId: secret.id, url: link }))).toBeNull();
    expect(site.hits.length).toBe(before);
    expect(ok(await bruno.socket.emitWithAck('link:preview', { messageId: secret.id, url: link }))?.title).toBeTruthy();
  });

  it('um link de imagem ou GIF vira a imagem', async () => {
    const link = site.url('/imagem.gif');
    const { ana, message } = await postedIn(link);
    const preview = ok(await ana.socket.emitWithAck('link:preview', { messageId: message.id, url: link }));
    expect(preview).toMatchObject({ kind: 'image', image: { width: 3, height: 2 } });
    expect((await fetch(`${server.url}/embed-image/${preview!.image!.id}`)).headers.get('content-type')).toBe('image/gif');
  });

  it('não entrega imagem de id que não existe ou que não é um id', async () => {
    expect((await fetch(`${server.url}/embed-image/00000000-0000-0000-0000-000000000000`)).status).toBe(404);
    expect((await fetch(`${server.url}/embed-image/../../etc/passwd`)).status).not.toBe(200);
    expect((await fetch(`${server.url}/embed-image/abc`)).status).not.toBe(200);
  });

  it('limita o ritmo dos pedidos de cada conexão', async () => {
    const link = site.url('/pagina');
    const { ana, message } = await postedIn(link);
    const results = await Promise.all(Array.from({ length: 60 }, () => ana.socket.emitWithAck('link:preview', { messageId: message.id, url: link })));
    expect(results.filter((r) => !r.ok).length).toBeGreaterThan(0);
  });
});

import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Attachment } from '../../../shared/src/models.js';
import { MAX_ATTACHMENT_BYTES } from '../../../shared/src/protocol.js';
import { PENDING_UPLOAD_TTL_MS, sweepUploads, UploadDir } from '../../src/uploads.js';
import { hasTestDatabase } from '../support/database.js';
import { channelNamed, fakePng, joinDemoSpace, nextEvent, ok, TestServer, type TestClient } from '../support/harness.js';

describe.skipIf(!hasTestDatabase)('anexos de imagem', () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await TestServer.start();
  });
  afterEach(() => server.disconnectAll());
  afterAll(() => server?.stop());

  async function uploaded(client: TestClient, data = fakePng(640, 480), name = 'foto.png'): Promise<Attachment> {
    const { status, body } = await server.upload(client.token, data, name);
    if (!body.ok) throw new Error(`Upload recusado (${status}): ${body.error}`);
    return body.attachment;
  }

  const fetchFile = (id: string) => fetch(`${server.url}/uploads/${id}`);

  it('só aceita quem tem sessão', async () => {
    const res = await server.upload('token-que-nao-existe-1234', fakePng(10, 10));
    expect(res.status).toBe(401);
  });

  it('recusa o que não é imagem e o que passa do limite', async () => {
    const ana = await server.connect('Ana');
    const svg = await server.upload(ana.token, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'));
    expect(svg.status).toBe(415);
    const huge = await server.upload(ana.token, fakePng(10, 10, MAX_ATTACHMENT_BYTES));
    expect(huge.status).toBe(413);
  });

  it('guarda tipo e dimensões lidos do arquivo, com nome limpo', async () => {
    const ana = await server.connect('Ana');
    // Extensão mentirosa e caminho no nome: valem o conteúdo e só o nome-base.
    const attachment = await uploaded(ana, fakePng(800, 600), '..\\..\\pasta/gato fofo.gif');
    expect(attachment).toMatchObject({ fileName: 'gato fofo.png', contentType: 'image/png', width: 800, height: 600 });
  });

  it('publica a imagem com a mensagem e serve o arquivo só depois disso', async () => {
    const ana = await server.connect('Ana');
    const bruno = await server.connect('Bruno');
    const geral = channelNamed(await joinDemoSpace(ana), 'geral');
    await joinDemoSpace(bruno);

    const data = fakePng(320, 240);
    const attachment = await uploaded(ana, data);
    expect((await fetchFile(attachment.id)).status).toBe(404); // ainda solto

    const received = nextEvent(bruno.socket, 'message:new', (m) => m.channelId === geral.id);
    const sent = ok(
      await ana.socket.emitWithAck('message:send', { channelId: geral.id, content: '', attachmentIds: [attachment.id] }),
    );
    expect(sent.content).toBe('');
    expect(sent.attachments).toEqual([attachment]);
    expect((await received).attachments).toEqual([attachment]);

    const res = await fetchFile(attachment.id);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await res.arrayBuffer()).equals(data)).toBe(true);

    await server.restart();
    const again = await server.connect('Carla');
    await joinDemoSpace(again);
    const history = ok(await again.socket.emitWithAck('channel:history', { channelId: geral.id }));
    expect(history.find((m) => m.id === sent.id)?.attachments).toEqual([attachment]);
  });

  it('mantém a ordem dos anexos e recusa anexo alheio ou já usado, sem gravar a mensagem', async () => {
    const ana = await server.connect('Ana');
    const bruno = await server.connect('Bruno');
    const geral = channelNamed(await joinDemoSpace(ana), 'geral');
    await joinDemoSpace(bruno);

    const [a, b] = [await uploaded(ana, fakePng(1, 1)), await uploaded(ana, fakePng(2, 2))];
    const sent = ok(
      await ana.socket.emitWithAck('message:send', { channelId: geral.id, content: 'duas', attachmentIds: [b.id, a.id] }),
    );
    expect(sent.attachments.map((x) => x.id)).toEqual([b.id, a.id]);

    const reused = await ana.socket.emitWithAck('message:send', { channelId: geral.id, content: 'de novo', attachmentIds: [a.id] });
    expect(reused.ok).toBe(false);

    const brunos = await uploaded(bruno);
    const stolen = await ana.socket.emitWithAck('message:send', {
      channelId: geral.id,
      content: 'roubada',
      attachmentIds: [brunos.id],
    });
    expect(stolen).toEqual({ ok: false, error: 'Anexo indisponível. Envie a imagem de novo.' });

    const history = ok(await ana.socket.emitWithAck('channel:history', { channelId: geral.id }));
    expect(history.map((m) => m.content)).not.toContain('roubada');
    expect(history.map((m) => m.content)).not.toContain('de novo');
  });

  it('recusa mais de 4 anexos ou anexos repetidos', async () => {
    const ana = await server.connect('Ana');
    const geral = channelNamed(await joinDemoSpace(ana), 'geral');
    const one = await uploaded(ana);
    const five = await ana.socket.emitWithAck('message:send', {
      channelId: geral.id,
      content: 'x',
      attachmentIds: ['1', '2', '3', '4', '5'],
    });
    expect(five.ok).toBe(false);
    const repeated = await ana.socket.emitWithAck('message:send', {
      channelId: geral.id,
      content: 'x',
      attachmentIds: [one.id, one.id],
    });
    expect(repeated.ok).toBe(false);
  });

  it('deixa a mensagem com imagem ficar sem texto ao editar, e apaga o arquivo junto com ela', async () => {
    const ana = await server.connect('Ana');
    const geral = channelNamed(await joinDemoSpace(ana), 'geral');
    const attachment = await uploaded(ana);
    const sent = ok(
      await ana.socket.emitWithAck('message:send', { channelId: geral.id, content: 'legenda', attachmentIds: [attachment.id] }),
    );
    const edited = ok(await ana.socket.emitWithAck('message:edit', { messageId: sent.id, content: '  ' }));
    expect(edited.content).toBe('');
    expect(edited.attachments).toEqual([attachment]);

    const file = join(server.uploadDir, attachment.id);
    expect(existsSync(file)).toBe(true);
    ok(await ana.socket.emitWithAck('message:delete', { messageId: sent.id }));
    expect((await fetchFile(attachment.id)).status).toBe(404);
    await expect.poll(() => existsSync(file)).toBe(false);
  });

  it('a limpeza apaga anexos soltos antigos e arquivos sem registro', async () => {
    const ana = await server.connect('Ana');
    const recent = await uploaded(ana);
    const old = await uploaded(ana);
    await server.db.attachment.update({
      where: { id: old.id },
      data: { createdAt: new Date(Date.now() - PENDING_UPLOAD_TTL_MS - 1000) },
    });
    const orphan = '00000000-0000-4000-8000-000000000000';
    await writeFile(join(server.uploadDir, orphan), 'sobra');

    await sweepUploads(server.db, new UploadDir(server.uploadDir));
    expect(existsSync(join(server.uploadDir, recent.id))).toBe(true);
    expect(existsSync(join(server.uploadDir, old.id))).toBe(false);
    expect(existsSync(join(server.uploadDir, orphan))).toBe(false);
    expect(await server.db.attachment.count({ where: { id: old.id } })).toBe(0);
  });
});

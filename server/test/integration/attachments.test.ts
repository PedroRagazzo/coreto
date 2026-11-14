import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Attachment } from '../../../shared/src/models.js';
import { MAX_ATTACHMENT_BYTES, type UploadChunkResponse } from '../../../shared/src/protocol.js';
import { ATTACHMENT_RETENTION_MS, cleanFileName, PENDING_UPLOAD_TTL_MS, sweepUploads, UploadDir } from '../../src/uploads.js';
import { hasTestDatabase } from '../support/database.js';
import { channelNamed, fakePng, joinDemoSpace, nextEvent, ok, TestServer, type TestClient } from '../support/harness.js';

describe.skipIf(!hasTestDatabase)('anexos', () => {
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

  it('recusa o que passa do limite e o arquivo vazio, sem deixar nada na pasta', async () => {
    const ana = await server.connect('Ana');
    const huge = await server.upload(ana.token, Buffer.alloc(MAX_ATTACHMENT_BYTES + 1, 1), 'enorme.bin');
    expect(huge.status).toBe(413);
    const empty = await server.upload(ana.token, Buffer.alloc(0), 'vazio.txt');
    expect(empty.status).toBe(400);
    expect(await readdir(server.uploadDir)).toEqual([]);
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
    expect(stolen).toEqual({ ok: false, error: 'Anexo indisponível. Envie o arquivo de novo.' });

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

  describe('arquivos que não são imagem', () => {
    async function inGeral() {
      const ana = await server.connect('Ana');
      const bruno = await server.connect('Bruno');
      const geral = channelNamed(await joinDemoSpace(ana), 'geral');
      await joinDemoSpace(bruno);
      return { ana, bruno, geral };
    }

    it('guarda o arquivo com o nome e o tamanho, sem dimensões, e entrega igualzinho', async () => {
      const { ana, bruno, geral } = await inGeral();
      const data = Buffer.from('conteudo do relatorio\n'.repeat(1000));
      const file = await uploaded(ana, data, 'relatório final.pdf');
      expect(file).toEqual({
        id: file.id,
        fileName: 'relatório final.pdf',
        contentType: 'application/octet-stream',
        size: data.length,
        width: null,
        height: null,
        expired: false,
      });

      const received = nextEvent(bruno.socket, 'message:new', (m) => m.channelId === geral.id);
      const sent = ok(await ana.socket.emitWithAck('message:send', { channelId: geral.id, content: '', attachmentIds: [file.id] }));
      expect(sent.attachments).toEqual([file]);
      expect((await received).attachments).toEqual([file]);

      const res = await fetchFile(file.id);
      expect(res.status).toBe(200);
      expect(Buffer.from(await res.arrayBuffer()).equals(data)).toBe(true);
      // O nome volta codificado, e o navegador baixa em vez de abrir.
      expect(res.headers.get('content-disposition')).toBe("attachment; filename*=UTF-8''relat%C3%B3rio%20final.pdf");
    });

    it('responde também a HEAD, só com os cabeçalhos', async () => {
      const { ana, geral } = await inGeral();
      const file = await uploaded(ana, Buffer.from('12345'), 'cinco.bin');
      ok(await ana.socket.emitWithAck('message:send', { channelId: geral.id, content: '', attachmentIds: [file.id] }));
      const res = await fetch(`${server.url}/uploads/${file.id}`, { method: 'HEAD' });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-length')).toBe('5');
      expect(res.headers.get('content-disposition')).toMatch(/^attachment;/);
      expect((await res.arrayBuffer()).byteLength).toBe(0);
      expect((await fetch(`${server.url}/uploads/00000000-0000-4000-8000-000000000000`, { method: 'HEAD' })).status).toBe(404);
    });

    it('nunca deixa o navegador abrir o arquivo: HTML, SVG e "imagens" falsas saem como download', async () => {
      const { ana, geral } = await inGeral();
      const attacks: [string, Buffer][] = [
        ['pagina.html', Buffer.from('<html><script>fetch("/x?"+localStorage.getItem("coreto.identity"))</script></html>')],
        ['desenho.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')],
        ['foto.png', Buffer.from('<html><script>alert(1)</script></html>')], // extensão de imagem, conteúdo de HTML
        ['script.js', Buffer.from('alert(1)')],
      ];
      for (const [name, data] of attacks) {
        const file = await uploaded(ana, data, name);
        expect(file.contentType).toBe('application/octet-stream');
        ok(await ana.socket.emitWithAck('message:send', { channelId: geral.id, content: name, attachmentIds: [file.id] }));
        const res = await fetchFile(file.id);
        expect(res.headers.get('content-type')).toBe('application/octet-stream');
        expect(res.headers.get('content-disposition')).toMatch(/^attachment;/);
        expect(res.headers.get('x-content-type-options')).toBe('nosniff');
        expect(res.headers.get('content-security-policy')).toContain('sandbox');
      }
    });

    it('uma imagem de verdade continua sendo imagem, mesmo com nome de outro tipo', async () => {
      const { ana } = await inGeral();
      const image = await uploaded(ana, fakePng(30, 20), 'documento.pdf');
      expect(image).toMatchObject({ contentType: 'image/png', width: 30, height: 20, fileName: 'documento.png' });
    });

    it('um arquivo grande (maior que o limite das imagens) vai inteiro para o disco', async () => {
      const { ana, geral } = await inGeral();
      const big = Buffer.alloc(20 * 1024 * 1024);
      for (let i = 0; i < big.length; i += 4096) big[i] = i % 251;
      const file = await uploaded(ana, big, 'jogo-salvo.zip');
      expect(file.size).toBe(big.length);
      ok(await ana.socket.emitWithAck('message:send', { channelId: geral.id, content: '', attachmentIds: [file.id] }));
      const res = await fetchFile(file.id);
      expect(Buffer.from(await res.arrayBuffer()).equals(big)).toBe(true);
    });

    it('mistura imagens e arquivos na mesma mensagem, na ordem', async () => {
      const { ana, geral } = await inGeral();
      const [doc, img] = [await uploaded(ana, Buffer.from('texto'), 'notas.txt'), await uploaded(ana, fakePng(5, 5))];
      const sent = ok(
        await ana.socket.emitWithAck('message:send', { channelId: geral.id, content: 'dois', attachmentIds: [doc.id, img.id] }),
      );
      expect(sent.attachments.map((a) => [a.fileName, a.width])).toEqual([
        ['notas.txt', null],
        ['foto.png', 5],
      ]);
    });

    it('a busca separa imagens de arquivos', async () => {
      const { ana, geral } = await inGeral();
      const doc = await uploaded(ana, Buffer.from('texto'), 'planilha.xlsx');
      const img = await uploaded(ana, fakePng(5, 5));
      const withDoc = ok(await ana.socket.emitWithAck('message:send', { channelId: geral.id, content: 'tem arquivo', attachmentIds: [doc.id] }));
      const withImg = ok(await ana.socket.emitWithAck('message:send', { channelId: geral.id, content: 'tem imagem', attachmentIds: [img.id] }));
      const scope = { spaceId: ana.spaces[0]!.id };
      const find = async (has: 'image' | 'file') =>
        ok(await ana.socket.emitWithAck('message:search', { has, scope })).messages.map((m) => m.id);
      // (outros testes deste arquivo também deixaram anexos no canal: só importa quem aparece e quem não)
      const files = await find('file');
      expect(files).toContain(withDoc.id);
      expect(files).not.toContain(withImg.id);
      const images = await find('image');
      expect(images).toContain(withImg.id);
      expect(images).not.toContain(withDoc.id);
    });

    it('apagar a mensagem apaga o arquivo do disco', async () => {
      const { ana, geral } = await inGeral();
      const file = await uploaded(ana, Buffer.from('apague-me'), 'rascunho.txt');
      const sent = ok(await ana.socket.emitWithAck('message:send', { channelId: geral.id, content: '', attachmentIds: [file.id] }));
      const path = join(server.uploadDir, file.id);
      expect(existsSync(path)).toBe(true);
      ok(await ana.socket.emitWithAck('message:delete', { messageId: sent.id }));
      await expect.poll(() => existsSync(path)).toBe(false);
    });

    it('a limpeza também apaga o provisório de um envio interrompido, mas não o recente', async () => {
      const stale = join(server.uploadDir, '11111111-1111-4111-8111-111111111111.part');
      const fresh = join(server.uploadDir, '22222222-2222-4222-8222-222222222222.part');
      await writeFile(stale, 'pela metade');
      await writeFile(fresh, 'chegando agora');
      const old = new Date(Date.now() - PENDING_UPLOAD_TTL_MS - 60_000);
      await utimes(stale, old, old);
      await sweepUploads(server.db, new UploadDir(server.uploadDir));
      expect(existsSync(stale)).toBe(false);
      expect(existsSync(fresh)).toBe(true);
      await sweepUploads(server.db, new UploadDir(server.uploadDir), Date.now() + 2 * PENDING_UPLOAD_TTL_MS);
      expect(existsSync(fresh)).toBe(false);
    });

    describe('prazo de validade', () => {
      const age = (id: string, ms: number) =>
        server.db.attachment.update({ where: { id }, data: { createdAt: new Date(Date.now() - ms) } });

      it('passado o prazo a limpeza apaga o arquivo, mas a mensagem fica com o anexo marcado como apagado', async () => {
        const { ana, bruno, geral } = await inGeral();
        const oldFile = await uploaded(ana, Buffer.from('velho'), 'velho.txt');
        const oldImage = await uploaded(ana, fakePng(64, 48), 'velha.png');
        const recent = await uploaded(ana, Buffer.from('novo'), 'novo.txt');
        const sentOld = ok(
          await ana.socket.emitWithAck('message:send', { channelId: geral.id, content: 'antigo', attachmentIds: [oldFile.id, oldImage.id] }),
        );
        ok(await ana.socket.emitWithAck('message:send', { channelId: geral.id, content: 'recente', attachmentIds: [recent.id] }));
        await age(oldFile.id, ATTACHMENT_RETENTION_MS + 60_000);
        await age(oldImage.id, ATTACHMENT_RETENTION_MS + 60_000);
        await age(recent.id, ATTACHMENT_RETENTION_MS - 60 * 60_000); // falta uma hora para vencer

        await sweepUploads(server.db, new UploadDir(server.uploadDir));

        expect(existsSync(join(server.uploadDir, oldFile.id))).toBe(false);
        expect(existsSync(join(server.uploadDir, oldImage.id))).toBe(false);
        expect(existsSync(join(server.uploadDir, recent.id))).toBe(true);
        expect((await fetchFile(oldFile.id)).status).toBe(404);
        expect((await fetchFile(recent.id)).status).toBe(200);

        // Quem abre o canal depois vê a mensagem, com os anexos antigos marcados e o recente intacto.
        const history = ok(await bruno.socket.emitWithAck('channel:history', { channelId: geral.id }));
        const old = history.find((m) => m.id === sentOld.id)!;
        expect(old.content).toBe('antigo');
        expect(old.attachments).toEqual([
          { ...oldFile, expired: true },
          { ...oldImage, expired: true },
        ]);
        expect(history.find((m) => m.content === 'recente')!.attachments).toEqual([{ ...recent, expired: false }]);
      });

      it('a limpeza refeita não mexe de novo no que já venceu, e termina o serviço se o arquivo ficou para trás', async () => {
        const { ana, geral } = await inGeral();
        const file = await uploaded(ana, Buffer.from('teimoso'), 'teimoso.txt');
        ok(await ana.socket.emitWithAck('message:send', { channelId: geral.id, content: '', attachmentIds: [file.id] }));
        await age(file.id, ATTACHMENT_RETENTION_MS + 60_000);
        await sweepUploads(server.db, new UploadDir(server.uploadDir));
        const { expiredAt } = (await server.db.attachment.findUnique({ where: { id: file.id } }))!;
        expect(expiredAt).not.toBeNull();

        // Servidor caiu no meio: o registro já está marcado, mas o arquivo continua no disco.
        await writeFile(join(server.uploadDir, file.id), 'teimoso');
        await sweepUploads(server.db, new UploadDir(server.uploadDir), Date.now() + 60_000);
        expect(existsSync(join(server.uploadDir, file.id))).toBe(false);
        expect((await server.db.attachment.findUnique({ where: { id: file.id } }))!.expiredAt).toEqual(expiredAt);
      });

      it('apagar a mensagem depois do prazo não deixa o registro para trás', async () => {
        const { ana, geral } = await inGeral();
        const file = await uploaded(ana, Buffer.from('some'), 'some.txt');
        const sent = ok(await ana.socket.emitWithAck('message:send', { channelId: geral.id, content: '', attachmentIds: [file.id] }));
        await age(file.id, ATTACHMENT_RETENTION_MS + 60_000);
        await sweepUploads(server.db, new UploadDir(server.uploadDir));
        ok(await ana.socket.emitWithAck('message:delete', { messageId: sent.id }));
        expect(await server.db.attachment.count({ where: { id: file.id } })).toBe(0);
      });
    });
  });

  describe('nome do arquivo', () => {
    const name = (raw: string, extension?: string) => cleanFileName(encodeURIComponent(raw), extension);

    it('tira o caminho e os caracteres de controle e de direção do texto (o truque do "exe" disfarçado)', () => {
      expect(name('..\\..\\pasta/relatorio.pdf')).toBe('relatorio.pdf');
      expect(name('foto\u202Egpj.exe')).toBe('fotogpj.exe');
      expect(name('a\u0000b\n.txt')).toBe('ab.txt');
    });

    it('guarda a extensão original dos arquivos, desde que seja só letras e números', () => {
      expect(name('arquivo.tar.gz')).toBe('arquivo.tar.gz');
      expect(name('Planilha Final.XLSX')).toBe('Planilha Final.XLSX');
      expect(name('estranho.<b>')).toBe('estranho.<b>'); // sem extensão válida: é tudo nome
      expect(name('sem-extensao')).toBe('sem-extensao');
    });

    it('nomes vazios ou só de pontos viram "arquivo" (ou "imagem")', () => {
      expect(name('')).toBe('arquivo');
      expect(name('...')).toBe('arquivo');
      expect(name('.gitignore')).toBe('gitignore');
      expect(name('', 'png')).toBe('imagem.png');
    });

    it('cabe em 100 letras mantendo a extensão', () => {
      const long = name(`${'a'.repeat(300)}.pdf`);
      expect(long).toHaveLength(100);
      expect(long.endsWith('.pdf')).toBe(true);
    });

    it('com a extensão do tipo real, troca a que o nome tinha', () => {
      expect(name('gato.gif', 'png')).toBe('gato.png');
    });

    it('um cabeçalho malformado vira o nome padrão', () => {
      expect(cleanFileName('%E0%A4%A', undefined)).toBe('arquivo');
    });
  });
});

describe.skipIf(!hasTestDatabase)('envio em pedaços', () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await TestServer.start({ uploadQuotaBytes: 20_000_000 });
  });
  afterEach(() => server.disconnectAll());
  afterAll(() => server?.stop());

  const id = () => randomUUID();
  const parts = async () => (await readdir(server.uploadDir)).filter((n) => n.endsWith('.part'));
  /** Um arquivo de `size` bytes que não se repete, para notar se algum pedaço foi gravado fora do lugar. */
  const content = (size: number) => {
    const data = Buffer.alloc(size);
    for (let i = 0; i < size; i++) data[i] = (i * 31 + (i >> 8)) % 251;
    return data;
  };
  const attachmentOf = (body: UploadChunkResponse): Attachment => {
    if (!body.ok || !('attachment' in body)) throw new Error('faltou o anexo');
    return body.attachment;
  };

  it('junta os pedaços em ordem e entrega o arquivo igualzinho', async () => {
    const ana = await server.connect('Ana');
    const geral = channelNamed(await joinDemoSpace(ana), 'geral');
    const data = content(2_500_000);
    const upload = id();
    const send = (offset: number, end: number) =>
      server.uploadChunk(ana.token, { id: upload, offset, total: data.length, data: data.subarray(offset, end), fileName: 'jogo.zip' });

    expect(await send(0, 1_000_000)).toEqual({ status: 200, body: { ok: true, received: 1_000_000 } });
    expect(await send(1_000_000, 2_000_000)).toEqual({ status: 200, body: { ok: true, received: 2_000_000 } });
    expect(await parts()).toEqual([`${upload}.part`]);
    const last = await send(2_000_000, data.length);
    expect(last.status).toBe(201);
    const attachment = attachmentOf(last.body);
    expect(attachment).toMatchObject({ fileName: 'jogo.zip', size: data.length, contentType: 'application/octet-stream' });
    expect(await parts()).toEqual([]);

    ok(await ana.socket.emitWithAck('message:send', { channelId: geral.id, content: '', attachmentIds: [attachment.id] }));
    const res = await fetch(`${server.url}/uploads/${attachment.id}`);
    expect(Buffer.from(await res.arrayBuffer()).equals(data)).toBe(true);
  });

  it('um pedaço repetido ou fora de ordem recebe 409 com o ponto de onde continuar, sem estragar o arquivo', async () => {
    const ana = await server.connect('Ana');
    const data = content(1_500_000);
    const upload = id();
    const send = (offset: number, end: number) =>
      server.uploadChunk(ana.token, { id: upload, offset, total: data.length, data: data.subarray(offset, end) });

    await send(0, 600_000);
    expect(await send(900_000, data.length)).toEqual({
      status: 409,
      body: { ok: false, error: 'Pedaço fora de ordem.', received: 600_000 },
    });
    expect(await send(600_000, 1_000_000)).toMatchObject({ status: 200, body: { received: 1_000_000 } });
    // A resposta se perdeu e o site manda o mesmo pedaço de novo: o servidor já passou dele e diz onde está.
    expect(await send(600_000, 1_000_000)).toMatchObject({ status: 409, body: { received: 1_000_000 } });
    // Recomeçar do zero é permitido (o que havia é descartado).
    expect(await send(0, 600_000)).toMatchObject({ status: 200, body: { received: 600_000 } });
    expect(await send(600_000, 1_000_000)).toMatchObject({ status: 200 });
    const attachment = attachmentOf((await send(1_000_000, data.length)).body);
    expect((await readFile(join(server.uploadDir, attachment.id))).equals(data)).toBe(true);
  });

  it('só quem começou o envio continua, e um envio desconhecido manda recomeçar', async () => {
    const ana = await server.connect('Ana');
    const bruno = await server.connect('Bruno');
    const data = content(1_000_000);
    const upload = id();
    await server.uploadChunk(ana.token, { id: upload, offset: 0, total: data.length, data: data.subarray(0, 400_000) });

    const intruder = await server.uploadChunk(bruno.token, { id: upload, offset: 400_000, total: data.length, data: data.subarray(400_000) });
    expect(intruder).toMatchObject({ status: 409, body: { received: 0 } });
    const hijack = await server.uploadChunk(bruno.token, { id: upload, offset: 0, total: data.length, data: data.subarray(0, 400_000) });
    expect(hijack.status).toBe(409);
    const unknown = await server.uploadChunk(ana.token, { id: id(), offset: 400_000, total: data.length, data: data.subarray(400_000) });
    expect(unknown).toMatchObject({ status: 409, body: { received: 0 } });
    const noSession = await server.uploadChunk('token-que-nao-existe-1234', { id: upload, offset: 400_000, total: data.length, data: data.subarray(400_000) });
    expect(noSession.status).toBe(401);
    // O envio da Ana segue de onde parou, intacto.
    const done = await server.uploadChunk(ana.token, { id: upload, offset: 400_000, total: data.length, data: data.subarray(400_000) });
    expect(done.status).toBe(201);
  });

  it('recusa pedido malformado, arquivo grande demais e pedaço maior que o combinado, sem deixar provisório', async () => {
    const ana = await server.connect('Ana');
    const bad = await server.uploadChunk(ana.token, { id: 'nao-e-uuid', offset: 0, total: 10, data: Buffer.alloc(5) });
    expect(bad.status).toBe(400);
    const tooBig = await server.uploadChunk(ana.token, { id: id(), offset: 0, total: MAX_ATTACHMENT_BYTES + 1, data: Buffer.alloc(5) });
    expect(tooBig.status).toBe(413);
    const empty = await server.uploadChunk(ana.token, { id: id(), offset: 0, total: 10, data: Buffer.alloc(0) });
    expect(empty.status).toBe(400);
    // O pedaço traz mais bytes do que faltam para fechar o arquivo.
    const over = await server.uploadChunk(ana.token, { id: id(), offset: 0, total: 10, data: Buffer.alloc(20, 1) });
    expect(over.status).toBe(413);
    expect(await parts()).toEqual([]);
  });

  it('confere o espaço logo no primeiro pedaço, contando o arquivo todo', async () => {
    const ana = await server.connect('Ana');
    const res = await server.uploadChunk(ana.token, { id: id(), offset: 0, total: 25_000_000, data: Buffer.alloc(1000, 1) });
    expect(res.status).toBe(507);
    expect(await parts()).toEqual([]);
  });

  it('reconhece imagem pelo conteúdo mesmo chegando em pedaços', async () => {
    const ana = await server.connect('Ana');
    const png = fakePng(640, 480);
    const upload = id();
    const half = Math.floor(png.length / 2);
    await server.uploadChunk(ana.token, { id: upload, offset: 0, total: png.length, data: png.subarray(0, half), fileName: 'foto.bin' });
    const last = await server.uploadChunk(ana.token, { id: upload, offset: half, total: png.length, data: png.subarray(half), fileName: 'foto.bin' });
    expect(last.status).toBe(201);
    expect(attachmentOf(last.body)).toMatchObject({ contentType: 'image/png', width: 640, height: 480, fileName: 'foto.png' });
  });

  it('a limpeza apaga o provisório de um envio parado', async () => {
    const ana = await server.connect('Ana');
    const upload = id();
    await server.uploadChunk(ana.token, { id: upload, offset: 0, total: 1_000_000, data: content(300_000) });
    expect(await parts()).toEqual([`${upload}.part`]);
    await sweepUploads(server.db, new UploadDir(server.uploadDir), Date.now() + PENDING_UPLOAD_TTL_MS + 60_000);
    expect(await parts()).toEqual([]);
  });
});

describe.skipIf(!hasTestDatabase)('cota de espaço dos anexos', () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await TestServer.start({ uploadQuotaBytes: 1000 });
  });
  afterEach(() => server.disconnectAll());
  afterAll(() => server?.stop());

  it('recusa o que não cabe e deixa passar o que cabe, contando só o que já foi enviado', async () => {
    const ana = await server.connect('Ana');
    const first = await server.upload(ana.token, Buffer.alloc(600, 1), 'a.bin');
    expect(first.status).toBe(201);
    const second = await server.upload(ana.token, Buffer.alloc(600, 2), 'b.bin');
    expect(second.status).toBe(507);
    expect(second.body.ok).toBe(false);
    expect((await readdir(server.uploadDir)).filter((n) => n.endsWith('.part'))).toEqual([]);
    const small = await server.upload(ana.token, Buffer.alloc(300, 3), 'c.bin');
    expect(small.status).toBe(201);
  });
});

describe.skipIf(!hasTestDatabase)('cota de espaço e prazo dos anexos', () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await TestServer.start({ uploadQuotaBytes: 1000 });
  });
  afterEach(() => server.disconnectAll());
  afterAll(() => server?.stop());

  it('o arquivo que venceu deixa de contar na cota', async () => {
    const ana = await server.connect('Ana');
    const geral = channelNamed(await joinDemoSpace(ana), 'geral');
    const full = await server.upload(ana.token, Buffer.alloc(900, 1), 'grande.bin');
    if (!full.body.ok) throw new Error(`Upload recusado (${full.status}): ${full.body.error}`);
    ok(await ana.socket.emitWithAck('message:send', { channelId: geral.id, content: '', attachmentIds: [full.body.attachment.id] }));
    expect((await server.upload(ana.token, Buffer.alloc(900, 2), 'outro.bin')).status).toBe(507);

    await server.db.attachment.update({
      where: { id: full.body.attachment.id },
      data: { createdAt: new Date(Date.now() - ATTACHMENT_RETENTION_MS - 60_000) },
    });
    await sweepUploads(server.db, new UploadDir(server.uploadDir));
    expect((await server.upload(ana.token, Buffer.alloc(900, 2), 'outro.bin')).status).toBe(201);
  });
});

// Anexos de imagem: POST /uploads recebe o arquivo, GET /uploads/<id> serve.
//
// O arquivo fica em disco (UPLOAD_DIR/<id>) e os metadados no banco. O id é
// um UUID aleatório: quem tem o link vê a imagem, como num CDN. Anexos que
// nunca entraram numa mensagem, e arquivos cujo registro sumiu (canal ou
// espaço excluído), são apagados por `sweepUploads`.

import { createReadStream } from 'node:fs';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { MAX_ATTACHMENT_BYTES, type UploadResponse } from '../../shared/src/protocol.js';
import type { Db } from './db/client.js';
import { imageInfo } from './images.js';
import type { Store } from './store.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_FILE_NAME = 100;
const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};
/** Anexos soltos (enviados mas nunca usados numa mensagem) vivem no máximo isso. */
export const PENDING_UPLOAD_TTL_MS = 60 * 60_000;

export class UploadDir {
  constructor(readonly path: string) {}

  async ensure(): Promise<void> {
    await mkdir(this.path, { recursive: true });
  }

  file(id: string): string {
    if (!UUID.test(id)) throw new Error(`Id de anexo inválido: ${id}`);
    return join(this.path, id);
  }

  async write(id: string, data: Buffer): Promise<void> {
    await writeFile(this.file(id), data, { flag: 'wx' });
  }

  async remove(ids: string[]): Promise<void> {
    await Promise.all(ids.map((id) => rm(this.file(id), { force: true })));
  }
}

/** Apaga anexos soltos antigos e arquivos sem registro no banco. */
export async function sweepUploads(db: Db, dir: UploadDir, now = Date.now()): Promise<number> {
  const stale = await db.attachment.findMany({
    where: { messageId: null, createdAt: { lt: new Date(now - PENDING_UPLOAD_TTL_MS) } },
    select: { id: true },
  });
  await db.attachment.deleteMany({ where: { id: { in: stale.map((a) => a.id) } } });

  const files = (await readdir(dir.path)).filter((name) => UUID.test(name));
  const known = new Set(
    (await db.attachment.findMany({ where: { id: { in: files } }, select: { id: true } })).map((a) => a.id),
  );
  const orphans = files.filter((name) => !known.has(name));
  await dir.remove(orphans);
  return orphans.length;
}

/** POST /uploads — corpo = arquivo cru, `Authorization: Bearer <token>`, `X-File-Name` opcional. */
export async function handleUpload(req: IncomingMessage, res: ServerResponse, store: Store, dir: UploadDir): Promise<void> {
  const send = (status: number, body: UploadResponse) =>
    void res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  const tooBig = () => send(413, { ok: false, error: `A imagem passa de ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB.` });

  if (req.method !== 'POST') return send(405, { ok: false, error: 'Use POST.' });
  const token = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1];
  const user = token ? await store.userForSession(token) : null;
  if (!user) return send(401, { ok: false, error: 'Sessão inválida. Entre de novo.' });
  if (Number(req.headers['content-length']) > MAX_ATTACHMENT_BYTES) return tooBig();

  const data = await readBody(req, MAX_ATTACHMENT_BYTES);
  if (!data) return tooBig();
  const info = imageInfo(data);
  if (!info) return send(415, { ok: false, error: 'Só dá para enviar imagens PNG, JPEG, GIF ou WebP.' });

  const attachment = await store.createAttachment({
    uploaderId: user.id,
    fileName: cleanFileName(req.headers['x-file-name'], EXTENSIONS[info.contentType]),
    contentType: info.contentType,
    size: data.length,
    width: info.width,
    height: info.height,
  });
  try {
    await dir.write(attachment.id, data);
  } catch (err) {
    await store.discardAttachment(attachment.id);
    throw err;
  }
  send(201, { ok: true, attachment });
}

/** GET /uploads/<id> — só anexos já publicados numa mensagem. */
export async function serveUpload(id: string, res: ServerResponse, store: Store, dir: UploadDir): Promise<void> {
  const attachment = UUID.test(id) ? await store.publishedAttachment(id) : null;
  if (!attachment) return void res.writeHead(404).end();

  const stream = createReadStream(dir.file(id));
  stream.once('error', () => {
    if (!res.headersSent) res.writeHead(404);
    res.end();
  });
  stream.once('open', () => {
    res.writeHead(200, {
      'content-type': attachment.contentType,
      'content-length': attachment.size,
      'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
      // O conteúdo de um id nunca muda.
      'cache-control': 'public, max-age=31536000, immutable',
      // O navegador não pode reinterpretar a imagem como outra coisa (HTML, script).
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'cross-origin-resource-policy': 'cross-origin',
    });
    stream.pipe(res);
  });
}

/** Lê o corpo inteiro; `null` se passar do limite. */
export function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) over = true; // continua lendo (e descartando) para conseguir responder 413
      else chunks.push(chunk);
    });
    req.on('end', () => resolve(over ? null : Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Nome exibido do arquivo: sem caminho nem caracteres de controle, com a extensão do tipo real. */
export function cleanFileName(header: string | string[] | undefined, extension: string): string {
  let name = '';
  try {
    name = decodeURIComponent(typeof header === 'string' ? header : '');
  } catch {
    // cabeçalho malformado: usa o nome padrão
  }
  const base = name
    .split(/[\\/]/)
    .pop()!
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/\.[^.]*$/, '')
    .trim()
    .slice(0, MAX_FILE_NAME - extension.length - 1);
  return `${base || 'imagem'}.${extension}`;
}

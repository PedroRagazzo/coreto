// Anexos: POST /uploads recebe o arquivo, GET /uploads/<id> serve.
//
// Um anexo é uma imagem (PNG, JPEG, GIF ou WebP reconhecida pelo conteúdo, até MAX_IMAGE_BYTES), que aparece na
// conversa, ou qualquer outro arquivo, que se baixa. O arquivo vai direto para o disco (UPLOAD_DIR/<id>), sem passar
// inteiro pela memória, e os metadados ficam no banco. O id é um UUID aleatório: quem tem o link baixa o arquivo, como
// num CDN. Anexos que nunca entraram numa mensagem, e arquivos cujo registro sumiu (canal ou espaço excluído), são
// apagados por `sweepUploads`.
//
// Segurança: um arquivo que não é imagem NUNCA é servido para o navegador abrir (um .html ou .svg rodaria dentro do
// site, com acesso à sessão de quem abrir). Sai sempre como `application/octet-stream`, `attachment` e `nosniff`.

import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readdir, rename, rm, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { isImageAttachment } from '../../shared/src/models.js';
import { FILE_CONTENT_TYPE, MAX_ATTACHMENT_BYTES, MAX_IMAGE_BYTES, type UploadResponse } from '../../shared/src/protocol.js';
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
/** Espaço padrão para todos os anexos juntos, em MB. */
const DEFAULT_QUOTA_MB = 10_240;

/** O espaço máximo dos anexos, em bytes: `UPLOAD_QUOTA_MB` (padrão 10 GB). */
export function uploadQuotaFromEnv(env: NodeJS.ProcessEnv): number {
  const mb = Number(env.UPLOAD_QUOTA_MB);
  return (Number.isFinite(mb) && mb > 0 ? mb : DEFAULT_QUOTA_MB) * 1024 * 1024;
}

export interface ReceivedUpload {
  /** O arquivo provisório, já completo (`<uuid>.part`, na pasta dos anexos). */
  part: string;
  size: number;
  /** O conteúdo inteiro, se couber em MAX_IMAGE_BYTES (para reconhecer imagens); senão `null`. */
  whole: Buffer | null;
}

export class UploadDir {
  constructor(
    readonly path: string,
    /** Espaço máximo de todos os anexos, em bytes. */
    readonly quotaBytes = Infinity,
  ) {}

  async ensure(): Promise<void> {
    await mkdir(this.path, { recursive: true });
  }

  file(id: string): string {
    if (!UUID.test(id)) throw new Error(`Id de anexo inválido: ${id}`);
    return join(this.path, id);
  }

  async remove(ids: string[]): Promise<void> {
    await Promise.all(ids.map((id) => rm(this.file(id), { force: true })));
  }

  /**
   * Grava o corpo do pedido num arquivo provisório, aos poucos, sem guardá-lo inteiro na memória. Devolve `null` se passar
   * de `limit` (o resto é lido e descartado para dar tempo de responder 413).
   */
  async receive(req: IncomingMessage, limit: number): Promise<ReceivedUpload | null> {
    const part = join(this.path, `${randomUUID()}.part`);
    const file = await open(part, 'wx');
    let size = 0;
    let over = false;
    let kept: Buffer[] | null = [];
    try {
      for await (const chunk of req as AsyncIterable<Buffer>) {
        if (over) continue;
        size += chunk.length;
        if (size > limit) {
          over = true;
          kept = null;
          continue;
        }
        if (kept) {
          if (size <= MAX_IMAGE_BYTES) kept.push(chunk);
          else kept = null;
        }
        await file.write(chunk);
      }
    } catch (err) {
      await file.close().catch(() => {});
      await rm(part, { force: true });
      throw err;
    }
    await file.close();
    if (over) {
      await rm(part, { force: true });
      return null;
    }
    return { part, size, whole: kept ? Buffer.concat(kept) : null };
  }

  /** Dá ao arquivo provisório o nome definitivo (o id do anexo). */
  async adopt(part: string, id: string): Promise<void> {
    await rename(part, this.file(id));
  }
}

/** Apaga anexos soltos antigos, arquivos sem registro no banco e provisórios de envios interrompidos. */
export async function sweepUploads(db: Db, dir: UploadDir, now = Date.now()): Promise<number> {
  const stale = await db.attachment.findMany({
    where: { messageId: null, createdAt: { lt: new Date(now - PENDING_UPLOAD_TTL_MS) } },
    select: { id: true },
  });
  await db.attachment.deleteMany({ where: { id: { in: stale.map((a) => a.id) } } });

  const names = await readdir(dir.path);
  // Um envio interrompido (conexão caiu, servidor reiniciou) deixa o provisório para trás.
  for (const name of names.filter((n) => n.endsWith('.part'))) {
    const { mtimeMs } = await stat(join(dir.path, name)).catch(() => ({ mtimeMs: now }));
    if (now - mtimeMs > PENDING_UPLOAD_TTL_MS) await rm(join(dir.path, name), { force: true });
  }

  const files = names.filter((name) => UUID.test(name));
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
  const tooBig = () => send(413, { ok: false, error: `O arquivo passa de ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB.` });
  const noRoom = () => send(507, { ok: false, error: 'O servidor está sem espaço para novos anexos. Avise quem cuida dele.' });

  if (req.method !== 'POST') return send(405, { ok: false, error: 'Use POST.' });
  const token = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1];
  const user = token ? await store.userForSession(token) : null;
  if (!user) return send(401, { ok: false, error: 'Sessão inválida. Entre de novo.' });
  const declared = Number(req.headers['content-length']);
  if (declared > MAX_ATTACHMENT_BYTES) return tooBig();
  const used = await store.attachmentBytes();
  if (used + (Number.isFinite(declared) ? declared : 0) > dir.quotaBytes) return noRoom();

  const received = await dir.receive(req, MAX_ATTACHMENT_BYTES);
  if (!received) return tooBig();
  const { part, size, whole } = received;
  try {
    if (size === 0) {
      await rm(part, { force: true });
      return send(400, { ok: false, error: 'O arquivo está vazio.' });
    }
    if (used + size > dir.quotaBytes) {
      await rm(part, { force: true });
      return noRoom();
    }
    // Imagem pelo conteúdo (não pela extensão nem pelo tipo declarado); o resto é só um arquivo.
    const image = whole ? imageInfo(whole) : null;
    const attachment = await store.createAttachment(
      image
        ? {
            uploaderId: user.id,
            fileName: cleanFileName(req.headers['x-file-name'], EXTENSIONS[image.contentType]),
            contentType: image.contentType,
            size,
            width: image.width,
            height: image.height,
          }
        : {
            uploaderId: user.id,
            fileName: cleanFileName(req.headers['x-file-name']),
            contentType: FILE_CONTENT_TYPE,
            size,
            width: null,
            height: null,
          },
    );
    try {
      await dir.adopt(part, attachment.id);
    } catch (err) {
      await store.discardAttachment(attachment.id);
      throw err;
    }
    send(201, { ok: true, attachment });
  } catch (err) {
    await rm(part, { force: true });
    throw err;
  }
}

/** `filename*=UTF-8''...` sem os caracteres que o RFC 5987 não aceita soltos. */
const encodedName = (name: string) =>
  encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** GET /uploads/<id> — só anexos já publicados numa mensagem. */
export async function serveUpload(id: string, res: ServerResponse, store: Store, dir: UploadDir, headOnly = false): Promise<void> {
  const attachment = UUID.test(id) ? await store.publishedAttachment(id) : null;
  if (!attachment) return void res.writeHead(404).end();

  const image = isImageAttachment(attachment);
  const headers = {
    // Imagem aparece na página; qualquer outro arquivo só baixa e nunca é interpretado pelo navegador.
    'content-type': image ? attachment.contentType : FILE_CONTENT_TYPE,
    'content-length': attachment.size,
    'content-disposition': `${image ? 'inline' : 'attachment'}; filename*=UTF-8''${encodedName(attachment.fileName)}`,
    // O conteúdo de um id nunca muda.
    'cache-control': 'public, max-age=31536000, immutable',
    // O navegador não pode reinterpretar o arquivo como outra coisa (HTML, script).
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; sandbox",
    'cross-origin-resource-policy': 'cross-origin',
  };
  if (headOnly) {
    // Só os cabeçalhos (gerenciadores de download perguntam o tamanho antes).
    const exists = await stat(dir.file(id)).then(() => true, () => false);
    return void (exists ? res.writeHead(200, headers).end() : res.writeHead(404).end());
  }

  const stream = createReadStream(dir.file(id));
  stream.once('error', () => {
    if (!res.headersSent) res.writeHead(404);
    res.end();
  });
  stream.once('open', () => {
    res.writeHead(200, headers);
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

/** O nome que aparece no anexo, sem caminho, sem caracteres de controle ou de direção do texto. */
function tidyName(header: string | string[] | undefined): string {
  let name = '';
  try {
    name = decodeURIComponent(typeof header === 'string' ? header : '');
  } catch {
    // cabeçalho malformado: usa o nome padrão
  }
  return name
    .split(/[\\/]/)
    .pop()!
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .trim();
}

/**
 * Nome exibido do anexo. Com `extension` (imagens), vale a extensão do tipo real: "gato.gif" que é um PNG vira
 * "gato.png". Sem ela (outros arquivos), a extensão do próprio nome fica como está, desde que seja só letras e números.
 */
export function cleanFileName(header: string | string[] | undefined, extension?: string): string {
  const name = tidyName(header);
  const dot = name.lastIndexOf('.');
  const original = dot > 0 ? name.slice(dot + 1) : '';
  const ext = extension ?? (/^[\p{L}\p{N}]{1,12}$/u.test(original) ? original : '');
  const stem = (extension !== undefined || ext ? name.slice(0, dot > 0 ? dot : name.length) : name)
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, MAX_FILE_NAME - ext.length - 1);
  const base = stem || (extension !== undefined ? 'imagem' : 'arquivo');
  return ext ? `${base}.${ext}` : base;
}

// Anexos: POST /uploads recebe o arquivo, GET /uploads/<id> serve.
//
// Um anexo é uma imagem (PNG, JPEG, GIF ou WebP reconhecida pelo conteúdo, até MAX_IMAGE_BYTES), que aparece na
// conversa, ou qualquer outro arquivo, que se baixa. O arquivo vai direto para o disco (UPLOAD_DIR/<id>), sem passar
// inteiro pela memória, e os metadados ficam no banco. O id é um UUID aleatório: quem tem o link baixa o arquivo, como
// num CDN. Anexos que nunca entraram numa mensagem, arquivos cujo registro sumiu (canal ou espaço excluído) e arquivos
// com mais de ATTACHMENT_RETENTION_DAYS dias são apagados por `sweepUploads` (nos que passaram do prazo, o registro
// fica marcado como `expiredAt`, para a mensagem mostrar que o arquivo foi apagado).
//
// Segurança: um arquivo que não é imagem NUNCA é servido para o navegador abrir (um .html ou .svg rodaria dentro do
// site, com acesso à sessão de quem abrir). Sai sempre como `application/octet-stream`, `attachment` e `nosniff`.

import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { isImageAttachment } from '../../shared/src/models.js';
import {
  ATTACHMENT_RETENTION_DAYS,
  FILE_CONTENT_TYPE,
  MAX_ATTACHMENT_BYTES,
  MAX_IMAGE_BYTES,
  MAX_UPLOAD_CHUNK_BYTES,
  type UploadChunkResponse,
} from '../../shared/src/protocol.js';
import type { Db } from './db/client.js';
import { imageInfo } from './images.js';
import type { Store } from './store.js';

type User = NonNullable<Awaited<ReturnType<Store['userForSession']>>>;

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
/** Um anexo já usado numa mensagem vive este tempo; depois o arquivo é apagado e só o aviso fica. */
export const ATTACHMENT_RETENTION_MS = ATTACHMENT_RETENTION_DAYS * 24 * 60 * 60_000;
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

/** Um envio em pedaços em andamento: o arquivo provisório já tem `size` bytes dos `total`. */
interface ChunkedUpload {
  userId: string;
  part: string;
  total: number;
  size: number;
  /** Um pedaço está sendo gravado agora (dois ao mesmo tempo embaralhariam o arquivo). */
  busy: boolean;
  updatedAt: number;
}
/** Quantos envios em pedaços podem estar abertos ao mesmo tempo no servidor todo. */
const MAX_CHUNKED_UPLOADS = 200;
/** Os quatro anexos de uma mensagem mais algumas folgas (abas, tentativas que ainda não expiraram). */
const MAX_CHUNKED_UPLOADS_PER_USER = 12;

export class UploadDir {
  /** Os envios em pedaços abertos, por id (o que quem envia escolheu). Os parados são esquecidos na limpeza. */
  readonly chunked = new Map<string, ChunkedUpload>();
  /** Bytes que os envios em andamento já prometeram ocupar (o que ainda não virou anexo no banco). */
  private reserved = 0;
  /** Fila do registro de anexos: um de cada vez, para dois envios não conferirem o espaço ao mesmo tempo. */
  private commitQueue: Promise<unknown> = Promise.resolve();

  constructor(
    readonly path: string,
    /** Espaço máximo de todos os anexos, em bytes. */
    readonly quotaBytes = Infinity,
  ) {}

  async ensure(): Promise<void> {
    await mkdir(this.path, { recursive: true });
  }

  /** O que os envios em andamento reservaram (conta junto com o que já está gravado nas cotas de espaço). */
  get reservedBytes(): number {
    return this.reserved;
  }

  /**
   * Cabem mais `bytes`, somando o que já está gravado (`used`) ao que os outros envios em andamento reservaram?
   * `own` é o que este próprio envio já reservou (não conta contra ele).
   */
  hasRoom(used: number, bytes: number, own = 0): boolean {
    return used + (this.reserved - own) + bytes <= this.quotaBytes;
  }

  reserve(bytes: number): void {
    this.reserved += bytes;
  }

  release(bytes: number): void {
    this.reserved = Math.max(0, this.reserved - bytes);
  }

  /** Roda `task` depois de todas as anteriores: o registro de um anexo confere o espaço sem outro conferir junto. */
  serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = this.commitQueue.then(task);
    this.commitQueue = run.catch(() => {});
    return run;
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

  /**
   * Grava o corpo do pedido no fim do arquivo provisório de um envio em pedaços, na posição `upload.size` (o que veio
   * de uma tentativa que falhou no meio é descartado, então repetir um pedaço é seguro). Devolve quantos bytes
   * chegaram, ou `null` se passar de `limit` (o resto é lido e descartado para dar tempo de responder).
   */
  async appendChunk(upload: ChunkedUpload, req: IncomingMessage, limit: number): Promise<number | null> {
    const file = await open(upload.part, upload.size === 0 ? 'w' : 'r+');
    let written = 0;
    let over = false;
    try {
      if (upload.size > 0) await file.truncate(upload.size);
      for await (const chunk of req as AsyncIterable<Buffer>) {
        if (over) continue;
        if (written + chunk.length > limit) {
          over = true;
          continue;
        }
        await file.write(chunk, 0, chunk.length, upload.size + written);
        written += chunk.length;
      }
    } finally {
      await file.close();
    }
    return over ? null : written;
  }

  /** Esquece um envio em pedaços e apaga o que ele tinha no disco. */
  async dropChunked(id: string): Promise<void> {
    const upload = this.chunked.get(id);
    this.chunked.delete(id);
    if (upload) {
      this.release(upload.total);
      await rm(upload.part, { force: true });
    }
  }

  /** Dá ao arquivo provisório o nome definitivo (o id do anexo). */
  async adopt(part: string, id: string): Promise<void> {
    await rename(part, this.file(id));
  }
}

/**
 * Apaga anexos soltos antigos, arquivos que passaram do prazo (`retentionMs`), arquivos sem registro no banco e provisórios
 * de envios interrompidos. Devolve quantos arquivos saíram do disco por não terem mais registro válido.
 */
export async function sweepUploads(db: Db, dir: UploadDir, now = Date.now(), retentionMs = ATTACHMENT_RETENTION_MS): Promise<number> {
  const stale = await db.attachment.findMany({
    where: { messageId: null, createdAt: { lt: new Date(now - PENDING_UPLOAD_TTL_MS) } },
    select: { id: true },
  });
  await db.attachment.deleteMany({ where: { id: { in: stale.map((a) => a.id) } } });

  // Passou do prazo (menos nos canais que guardam tudo): o registro fica (a mensagem mostra "arquivo apagado"), mas deixa de contar como conhecido logo abaixo,
  // e o arquivo sai do disco junto com os órfãos. Se o servidor cair no meio, a próxima limpeza termina o serviço.
  await db.attachment.updateMany({
    where: {
      messageId: { not: null },
      expiredAt: null,
      createdAt: { lt: new Date(now - retentionMs) },
      // Os canais que guardam os arquivos (`Channel.keepFiles`) ficam de fora.
      NOT: { message: { channel: { keepFiles: true } } },
    },
    data: { expiredAt: new Date(now) },
  });

  const names = await readdir(dir.path);
  // Um envio interrompido (conexão caiu, servidor reiniciou) deixa o provisório para trás.
  for (const name of names.filter((n) => n.endsWith('.part'))) {
    const { mtimeMs } = await stat(join(dir.path, name)).catch(() => ({ mtimeMs: now }));
    if (now - mtimeMs > PENDING_UPLOAD_TTL_MS) await rm(join(dir.path, name), { force: true });
  }

  for (const [id, upload] of dir.chunked) if (now - upload.updatedAt > PENDING_UPLOAD_TTL_MS) await dir.dropChunked(id);

  const files = names.filter((name) => UUID.test(name));
  // Os arquivos da pasta são anexos ou sons do quadro de som.
  const known = new Set([
    ...(await db.attachment.findMany({ where: { id: { in: files }, expiredAt: null }, select: { id: true } })).map((a) => a.id),
    ...(await db.soundClip.findMany({ where: { id: { in: files } }, select: { id: true } })).map((s) => s.id),
  ]);
  const orphans = files.filter((name) => !known.has(name));
  await dir.remove(orphans);
  return orphans.length;
}

/**
 * POST /uploads — corpo = arquivo cru, `Authorization: Bearer <token>`, `X-File-Name` opcional. Com `X-Upload-Id`, o corpo
 * é um pedaço do arquivo (ver `UPLOAD_CHUNK_BYTES` em protocol.ts).
 */
export async function handleUpload(req: IncomingMessage, res: ServerResponse, store: Store, dir: UploadDir): Promise<void> {
  const send = (status: number, body: UploadChunkResponse) =>
    void res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  const tooBig = () => send(413, { ok: false, error: `O arquivo passa de ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB.` });
  const noRoom = () => send(507, { ok: false, error: NO_ROOM });

  if (req.method !== 'POST') return send(405, { ok: false, error: 'Use POST.' });
  const token = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1];
  const user = token ? await store.userForSession(token) : null;
  if (!user) return send(401, { ok: false, error: 'Sessão inválida. Entre de novo.' });
  if (req.headers['x-upload-id'] !== undefined) return handleChunk(req, send, user, store, dir);
  const declared = Number(req.headers['content-length']);
  if (declared > MAX_ATTACHMENT_BYTES) return tooBig();
  // O espaço é reservado antes de receber o corpo: envios ao mesmo tempo não passam juntos da cota.
  const own = Number.isFinite(declared) ? declared : 0;
  if (!dir.hasRoom(await store.attachmentBytes(), own)) return noRoom();
  dir.reserve(own);
  try {
    const received = await dir.receive(req, MAX_ATTACHMENT_BYTES);
    if (!received) return tooBig();
    return await finishUpload(send, user, store, dir, received, own, req.headers['x-file-name']);
  } finally {
    dir.release(own);
  }
}

const NO_ROOM = 'O servidor está sem espaço para novos anexos. Avise quem cuida dele.';

/** Um pedaço de um envio em pedaços: guarda no arquivo provisório e, no último, publica o anexo como num envio único. */
async function handleChunk(
  req: IncomingMessage,
  send: (status: number, body: UploadChunkResponse) => void,
  user: User,
  store: Store,
  dir: UploadDir,
): Promise<void> {
  const header = (name: string) => (typeof req.headers[name] === 'string' ? (req.headers[name] as string) : '');
  const number = (name: string) => (/^\d{1,12}$/.test(header(name)) ? Number(header(name)) : NaN);
  const id = header('x-upload-id');
  const offset = number('x-upload-offset');
  const total = number('x-upload-total');
  const declared = Number(req.headers['content-length']);
  if (!UUID.test(id) || !Number.isInteger(offset) || !Number.isInteger(total) || total < 1) {
    return send(400, { ok: false, error: 'Pedaço de envio inválido.' });
  }
  if (total > MAX_ATTACHMENT_BYTES || declared > MAX_UPLOAD_CHUNK_BYTES) {
    return send(413, { ok: false, error: `O arquivo passa de ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB.` });
  }

  let upload = dir.chunked.get(id);
  if (offset === 0) {
    if (upload && upload.userId !== user.id) return send(409, { ok: false, error: 'Esse envio é de outra pessoa.' });
    if (upload?.busy) return send(409, { ok: false, error: 'Esse envio já está recebendo um pedaço.', received: upload.size });
    if (!upload && dir.chunked.size >= MAX_CHUNKED_UPLOADS) {
      return send(503, { ok: false, error: 'O servidor está recebendo arquivos demais agora. Tente de novo em instantes.' });
    }
    // Uma pessoa sozinha não ocupa todas as vagas de envio em andamento.
    if (!upload && [...dir.chunked.values()].filter((open) => open.userId === user.id).length >= MAX_CHUNKED_UPLOADS_PER_USER) {
      return send(429, { ok: false, error: 'Você já tem envios demais em andamento. Espere um terminar.' });
    }
    // Recomeçar um envio troca a reserva antiga (do mesmo id) pela nova.
    if (!dir.hasRoom(await store.attachmentBytes(), total, upload?.total ?? 0)) {
      await dir.dropChunked(id);
      return send(507, { ok: false, error: NO_ROOM });
    }
    if (upload) dir.release(upload.total);
    dir.reserve(total);
    upload = { userId: user.id, part: join(dir.path, `${id}.part`), total, size: 0, busy: false, updatedAt: Date.now() };
    dir.chunked.set(id, upload);
  } else {
    if (!upload || upload.userId !== user.id) {
      return send(409, { ok: false, error: 'Esse envio não existe mais. Envie o arquivo de novo.', received: 0 });
    }
    if (upload.busy || offset !== upload.size || total !== upload.total) {
      return send(409, { ok: false, error: 'Pedaço fora de ordem.', received: upload.size });
    }
  }

  upload.busy = true;
  try {
    // Nunca passa do que falta para fechar o arquivo (nem do tamanho máximo de um pedaço).
    const written = await dir.appendChunk(upload, req, Math.min(MAX_UPLOAD_CHUNK_BYTES, upload.total - upload.size));
    if (written === null) {
      await dir.dropChunked(id);
      return send(413, { ok: false, error: 'O pedaço é maior do que o combinado.' });
    }
    if (written === 0) {
      await dir.dropChunked(id);
      return send(400, { ok: false, error: 'O pedaço está vazio.' });
    }
    upload.size += written;
    upload.updatedAt = Date.now();
  } catch (err) {
    await dir.dropChunked(id);
    throw err;
  } finally {
    upload.busy = false;
  }
  if (upload.size < upload.total) return send(200, { ok: true, received: upload.size });

  // O arquivo está completo: segue como se tivesse chegado de uma vez. A reserva só sai depois de virar anexo.
  dir.chunked.delete(id);
  try {
    const whole = upload.total <= MAX_IMAGE_BYTES ? await readFile(upload.part) : null;
    return await finishUpload(send, user, store, dir, { part: upload.part, size: upload.size, whole }, upload.total, req.headers['x-file-name']);
  } catch (err) {
    await rm(upload.part, { force: true });
    throw err;
  } finally {
    dir.release(upload.total);
  }
}

/**
 * Com o arquivo provisório completo: confere o espaço de novo (outros envios podem ter ocupado o lugar enquanto este
 * chegava), reconhece imagem, registra o anexo e dá ao arquivo o nome definitivo. `own` é o que este envio reservou.
 */
async function finishUpload(
  send: (status: number, body: UploadChunkResponse) => void,
  user: User,
  store: Store,
  dir: UploadDir,
  { part, size, whole }: ReceivedUpload,
  own: number,
  fileNameHeader: string | string[] | undefined,
): Promise<void> {
  try {
    if (size === 0) {
      await rm(part, { force: true });
      return send(400, { ok: false, error: 'O arquivo está vazio.' });
    }
    // Imagem pelo conteúdo (não pela extensão nem pelo tipo declarado); o resto é só um arquivo.
    const image = whole ? imageInfo(whole) : null;
    const data = image
      ? {
          uploaderId: user.id,
          fileName: cleanFileName(fileNameHeader, EXTENSIONS[image.contentType]),
          contentType: image.contentType,
          size,
          width: image.width,
          height: image.height,
        }
      : {
          uploaderId: user.id,
          fileName: cleanFileName(fileNameHeader),
          contentType: FILE_CONTENT_TYPE,
          size,
          width: null,
          height: null,
        };
    const attachment = await dir.serialize(async () =>
      dir.hasRoom(await store.attachmentBytes(), size, own) ? store.createAttachment(data) : null,
    );
    if (!attachment) {
      await rm(part, { force: true });
      return send(507, { ok: false, error: NO_ROOM });
    }
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
    // O navegador desistiu no meio (rolou o chat, fechou a aba): sem isto o arquivo ficaria aberto até reiniciar.
    res.once('close', () => stream.destroy());
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

// Quadro de som: POST /sounds recebe um áudio curto, GET /sounds/<id> serve.
//
// O arquivo fica na pasta dos anexos (UPLOAD_DIR/<id>) e os dados no banco (SoundClip). O formato é reconhecido pelo
// conteúdo, e o arquivo é servido só como áudio (nunca como página). O id é um UUID aleatório e o link não exige
// login, como nos anexos. O site baixa o áudio e o toca no microfone de quem apertou.

import { createReadStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SoundUploadResponse } from '../../shared/src/protocol.js';
import { MAX_SOUND_BYTES, MAX_SOUNDS_PER_SPACE, cleanSoundEmoji, cleanSoundName, sniffAudio } from '../../shared/src/sounds.js';
import type { Store } from './store.js';
import type { UploadDir } from './uploads.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const header = (value: string | string[] | undefined): string => {
  try {
    return decodeURIComponent(typeof value === 'string' ? value : '');
  } catch {
    return '';
  }
};

/**
 * POST /sounds — corpo = o áudio cru, `Authorization: Bearer <token>`, `X-Space-Id`, `X-Sound-Name` e, se quiser,
 * `X-Sound-Emoji` (os dois últimos codificados com encodeURIComponent). Quem é do espaço pode acrescentar.
 */
export async function handleSoundUpload(
  req: IncomingMessage,
  res: ServerResponse,
  store: Store,
  dir: UploadDir,
  onChange: (spaceId: string) => void,
): Promise<void> {
  const send = (status: number, body: SoundUploadResponse) =>
    void res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));

  if (req.method !== 'POST') return send(405, { ok: false, error: 'Use POST.' });
  const token = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1];
  const user = token ? await store.userForSession(token) : null;
  if (!user) return send(401, { ok: false, error: 'Sessão inválida. Entre de novo.' });
  const spaceId = header(req.headers['x-space-id']);
  if (!store.member(spaceId, user.id)) return send(403, { ok: false, error: 'Você não participa deste espaço.' });
  const name = cleanSoundName(header(req.headers['x-sound-name']));
  if (!name) return send(400, { ok: false, error: 'Dê um nome ao som.' });
  const emoji = cleanSoundEmoji(header(req.headers['x-sound-emoji']));
  const tooBig = () => send(413, { ok: false, error: `O som passa de ${MAX_SOUND_BYTES / 1024} KB.` });
  if (Number(req.headers['content-length']) > MAX_SOUND_BYTES) return tooBig();
  if ((await store.soundCount(spaceId)) >= MAX_SOUNDS_PER_SPACE) {
    return send(409, { ok: false, error: `O quadro já tem ${MAX_SOUNDS_PER_SPACE} sons. Remova algum antes.` });
  }
  if ((await store.attachmentBytes()) + (await store.soundBytes()) > dir.quotaBytes) {
    return send(507, { ok: false, error: 'O servidor está sem espaço. Avise quem cuida dele.' });
  }

  const received = await dir.receive(req, MAX_SOUND_BYTES);
  if (!received) return tooBig();
  try {
    const kind = received.whole ? sniffAudio(received.whole) : null;
    if (!kind) {
      await rm(received.part, { force: true });
      return send(415, { ok: false, error: 'Só dá para enviar áudio MP3, OGG, WAV, WebM ou M4A.' });
    }
    const clip = await store.createSound({ spaceId, uploaderId: user.id, name, emoji, contentType: kind, size: received.size });
    try {
      await dir.adopt(received.part, clip.id);
    } catch (err) {
      await store.deleteSound(clip.id);
      throw err;
    }
    send(201, { ok: true, clip });
    onChange(spaceId);
  } catch (err) {
    await rm(received.part, { force: true });
    throw err;
  }
}

/** GET /sounds/<id>. */
export async function serveSound(id: string, res: ServerResponse, store: Store, dir: UploadDir, headOnly = false): Promise<void> {
  const clip = UUID.test(id) ? await store.findSound(id) : null;
  if (!clip) return void res.writeHead(404).end();
  const headers = {
    'content-type': clip.contentType,
    'content-length': clip.size,
    'cache-control': 'public, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; sandbox",
    // O site em desenvolvimento (outra porta) também baixa o som para tocá-lo.
    'access-control-allow-origin': '*',
    'cross-origin-resource-policy': 'cross-origin',
  };
  if (headOnly) return void res.writeHead(200, headers).end();
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

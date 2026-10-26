import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { SoundClip } from '../../../shared/src/models.js';
import { MAX_SOUND_BYTES, MAX_SOUNDS_PER_SPACE } from '../../../shared/src/sounds.js';
import { PENDING_UPLOAD_TTL_MS, sweepUploads, UploadDir } from '../../src/uploads.js';
import { hasTestDatabase } from '../support/database.js';
import { joinDemoSpace, nextEvent, ok, TestServer, type TestClient } from '../support/harness.js';

const mp3 = (size = 400) => {
  const data = Buffer.alloc(size, 7);
  data.write('ID3', 0, 'latin1');
  return data;
};

describe.skipIf(!hasTestDatabase)('quadro de som', () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await TestServer.start();
  });
  afterEach(() => server.disconnectAll());
  afterAll(() => server?.stop());

  async function inDemo(label: string) {
    const client = await server.connect(label);
    const snapshot = await joinDemoSpace(client);
    return { client, spaceId: snapshot.space.id };
  }

  async function addSound(
    client: TestClient,
    spaceId: string,
    { name = 'Palmas', emoji = '👏', data = mp3() }: { name?: string; emoji?: string | null; data?: Buffer } = {},
  ) {
    const res = await fetch(`${server.url}/sounds`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${client.token}`,
        'x-space-id': encodeURIComponent(spaceId),
        'x-sound-name': encodeURIComponent(name),
        ...(emoji ? { 'x-sound-emoji': encodeURIComponent(emoji) } : {}),
      },
      body: data,
    });
    return { status: res.status, body: (await res.json()) as { ok: true; clip: SoundClip } | { ok: false; error: string } };
  }

  const added = async (client: TestClient, spaceId: string, options?: Parameters<typeof addSound>[2]) => {
    const { status, body } = await addSound(client, spaceId, options);
    if (!body.ok) throw new Error(`Recusado (${status}): ${body.error}`);
    return body.clip;
  };

  it('guarda o som, avisa o espaço e entrega o áudio só como áudio', async () => {
    const { client: ana, spaceId } = await inDemo('Ana');
    const { client: bruno } = await inDemo('Bruno');
    const updated = nextEvent(bruno.socket, 'sounds:updated', (e) => e.spaceId === spaceId);

    const clip = await added(ana, spaceId, { name: '  Palmas   da torcida ', emoji: '👏' });
    expect(clip).toMatchObject({ spaceId, name: 'Palmas da torcida', emoji: '👏', uploaderId: ana.user.id, contentType: 'audio/mpeg', size: 400 });
    expect((await updated).clips.map((c) => c.id)).toContain(clip.id);

    const list = ok(await bruno.socket.emitWithAck('sounds:list', { spaceId }));
    expect(list.find((c) => c.id === clip.id)).toEqual(clip);

    const res = await fetch(`${server.url}/sounds/${clip.id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toContain('sandbox');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(Buffer.from(await res.arrayBuffer()).equals(mp3())).toBe(true);
    expect((await fetch(`${server.url}/sounds/${clip.id}`, { method: 'HEAD' })).headers.get('content-length')).toBe('400');
  });

  it('o emoji é opcional e só vale se for um emoji', async () => {
    const { client: ana, spaceId } = await inDemo('Ana');
    expect((await added(ana, spaceId, { name: 'Sem emoji', emoji: null })).emoji).toBeNull();
    expect((await added(ana, spaceId, { name: 'Emoji falso', emoji: 'abc' })).emoji).toBeNull();
  });

  it('recusa o que não é áudio, o que passa do limite, sem nome e de quem não é do espaço', async () => {
    const { client: ana, spaceId } = await inDemo('Ana');
    const html = await addSound(ana, spaceId, { data: Buffer.from('<html><script>alert(1)</script></html>'.padEnd(64, ' ')) });
    expect(html.status).toBe(415);
    const huge = await addSound(ana, spaceId, { data: Buffer.concat([mp3(), Buffer.alloc(MAX_SOUND_BYTES)]) });
    expect(huge.status).toBe(413);
    const unnamed = await addSound(ana, spaceId, { name: '   ' });
    expect(unnamed.status).toBe(400);

    // No protótipo todos são membros de todos os espaços; um espaço que não existe (ou do qual a pessoa saiu) é recusado.
    const denied = await addSound(ana, '00000000-0000-4000-8000-000000000000');
    expect(denied.status).toBe(403);
    const noToken = await fetch(`${server.url}/sounds`, { method: 'POST', headers: { 'x-space-id': spaceId, 'x-sound-name': 'x' }, body: mp3() });
    expect(noToken.status).toBe(401);
  });

  it('há um limite de sons por espaço', async () => {
    const { client: ana, spaceId } = await inDemo('Ana');
    const have = ok(await ana.socket.emitWithAck('sounds:list', { spaceId })).length;
    for (let i = have; i < MAX_SOUNDS_PER_SPACE; i++) await added(ana, spaceId, { name: `Som ${i}`, emoji: null });
    const full = await addSound(ana, spaceId, { name: 'Um a mais' });
    expect(full.status).toBe(409);
  });

  it('só quem enviou (ou quem gerencia o espaço) remove, e o arquivo some do disco', async () => {
    const { client: ana, spaceId } = await inDemo('Ana');
    const { client: bruno } = await inDemo('Bruno');
    const { client: carla } = await inDemo('Carla');
    // Abre espaço, caso outro teste tenha enchido o quadro.
    for (const old of ok(await ana.socket.emitWithAck('sounds:list', { spaceId }))) {
      server.makeSuperAdmin(ana.user.displayName);
      ok(await ana.socket.emitWithAck('sound:remove', { id: old.id }));
    }
    server.makeSuperAdmin(); // ninguém é administrador geral daqui para a frente

    const clip = await added(ana, spaceId, { name: 'Do Ana' });
    const file = join(server.uploadDir, clip.id);
    expect(existsSync(file)).toBe(true);

    expect((await bruno.socket.emitWithAck('sound:remove', { id: clip.id })).ok).toBe(false);
    expect((await bruno.socket.emitWithAck('sound:remove', { id: 'nao-existe' })).ok).toBe(false);

    const updated = nextEvent(carla.socket, 'sounds:updated', (e) => e.spaceId === spaceId);
    ok(await ana.socket.emitWithAck('sound:remove', { id: clip.id }));
    expect((await updated).clips.map((c) => c.id)).not.toContain(clip.id);
    expect(existsSync(file)).toBe(false);
    expect((await fetch(`${server.url}/sounds/${clip.id}`)).status).toBe(404);

    const another = await added(bruno, spaceId, { name: 'Do Bruno' });
    server.makeSuperAdmin(carla.user.displayName);
    ok(await carla.socket.emitWithAck('sound:remove', { id: another.id })); // administrador remove o de outra pessoa
    server.makeSuperAdmin();
  });

  it('recusa lista e remoção de espaço ou som que não existem, e pedidos malformados', async () => {
    const { client: ana } = await inDemo('Ana');
    const nowhere = '00000000-0000-4000-8000-000000000000';
    expect((await ana.socket.emitWithAck('sounds:list', { spaceId: nowhere })).ok).toBe(false);
    expect((await ana.socket.emitWithAck('sounds:list', { spaceId: 5 as unknown as string })).ok).toBe(false);
    expect((await ana.socket.emitWithAck('sound:remove', { id: nowhere })).ok).toBe(false);
    expect((await ana.socket.emitWithAck('sound:remove', { id: 7 as unknown as string })).ok).toBe(false);
  });

  it('a limpeza dos arquivos não apaga os sons, só o que sobrou sem registro', async () => {
    const { client: ana, spaceId } = await inDemo('Ana');
    const clip = await added(ana, spaceId, { name: 'Fica' });
    await sweepUploads(server.db, new UploadDir(server.uploadDir), Date.now() + 10 * PENDING_UPLOAD_TTL_MS);
    expect(existsSync(join(server.uploadDir, clip.id))).toBe(true);
  });
});

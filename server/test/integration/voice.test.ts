import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { VoiceParticipant } from '../../../shared/src/models.js';
import { MAX_WATCHED_STREAMS } from '../../../shared/src/models.js';
import { Permission } from '../../../shared/src/permissions.js';
import type { SignalPayload } from '../../../shared/src/protocol.js';
import { hasTestDatabase } from '../support/database.js';
import { channelNamed, expectNoEvent, joinDemoSpace, nextEvent, ok, TestServer, type TestClient } from '../support/harness.js';

const offer: SignalPayload = { kind: 'description', description: { type: 'offer', sdp: 'v=0' } };

describe.skipIf(!hasTestDatabase)('salas de voz', () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await TestServer.start();
  });
  afterEach(() => server.disconnectAll());
  afterAll(() => server?.stop());

  /** Conecta alguém, abre o espaço de demonstração e entra na sala de voz pedida. */
  async function inRoom(name: string, room: string): Promise<{ client: TestClient; peers: string[] }> {
    const client = await server.connect(name);
    const sala = channelNamed(await joinDemoSpace(client), room);
    const { peers } = ok(await client.socket.emitWithAck('voice:join', { channelId: sala.id }));
    return { client, peers };
  }

  it('entrega ao recém-chegado a lista de quem já está na sala', async () => {
    const ana = await inRoom('Ana', 'Sala de estar');
    expect(ana.peers).toEqual([]);

    const roster = nextEvent(ana.client.socket, 'voice:update', (p) => p.participants.length === 2);
    const bruno = await inRoom('Bruno', 'Sala de estar');
    expect(bruno.peers).toEqual([ana.client.user.id]);
    expect((await roster).participants.map((p) => p.userId).sort()).toEqual(
      [ana.client.user.id, bruno.client.user.id].sort(),
    );
  });

  it('entrega os servidores ICE e a política de transporte ao entrar', async () => {
    const client = await server.connect('Ana');
    const sala = channelNamed(await joinDemoSpace(client), 'Sala de estar');
    const joined = ok(await client.socket.emitWithAck('voice:join', { channelId: sala.id }));
    expect(joined.iceServers.length).toBeGreaterThan(0);
    expect(joined.iceTransportPolicy).toBe('all');
  });

  it('repassa a sinalização só entre quem está na mesma sala', async () => {
    const ana = await inRoom('Ana', 'Sala de estar');
    const bruno = await inRoom('Bruno', 'Sala de estar');
    const carla = await inRoom('Carla', 'Pareamento');

    const signal = nextEvent(bruno.client.socket, 'voice:signal');
    ana.client.socket.emit('voice:signal', { to: bruno.client.user.id, signal: offer });
    expect(await signal).toEqual({ from: ana.client.user.id, signal: offer });

    const nothing = expectNoEvent(carla.client.socket, 'voice:signal');
    ana.client.socket.emit('voice:signal', { to: carla.client.user.id, signal: offer });
    await nothing;
  });

  it('avisa os outros quando alguém sai da sala ou cai', async () => {
    const ana = await inRoom('Ana', 'Sala de estar');
    const bruno = await inRoom('Bruno', 'Sala de estar');
    const carla = await inRoom('Carla', 'Sala de estar');

    const brunoLeft = nextEvent(ana.client.socket, 'voice:peer-left', (p) => p.userId === bruno.client.user.id);
    bruno.client.socket.emit('voice:leave');
    await brunoLeft;

    const carlaLeft = nextEvent(ana.client.socket, 'voice:peer-left', (p) => p.userId === carla.client.user.id);
    carla.client.socket.disconnect();
    await carlaLeft;
  });

  it('entrar em outra sala tira a pessoa da anterior', async () => {
    const ana = await inRoom('Ana', 'Sala de estar');
    const bruno = await inRoom('Bruno', 'Sala de estar');
    const left = nextEvent(ana.client.socket, 'voice:peer-left', (p) => p.userId === bruno.client.user.id);
    const pareamento = channelNamed(await joinDemoSpace(bruno.client), 'Pareamento');
    ok(await bruno.client.socket.emitWithAck('voice:join', { channelId: pareamento.id }));
    await left;
  });

  describe('câmera', () => {
    it('mostra quem está com a câmera ligada e desliga ao sair', async () => {
      const ana = await inRoom('Ana', 'Sala de estar');
      const bruno = await inRoom('Bruno', 'Sala de estar');
      const on = nextEvent(bruno.client.socket, 'voice:update', (u) =>
        u.participants.some((p) => p.userId === ana.client.user.id && p.video),
      );
      ok(await ana.client.socket.emitWithAck('voice:video', { enabled: true }));
      await on;

      const off = nextEvent(bruno.client.socket, 'voice:update', (u) =>
        u.participants.some((p) => p.userId === ana.client.user.id && !p.video),
      );
      ok(await ana.client.socket.emitWithAck('voice:video', { enabled: false }));
      await off;
    });

    it('recusa ligar a câmera fora de uma sala', async () => {
      const fora = await server.connect('Fora');
      expect((await fora.socket.emitWithAck('voice:video', { enabled: true })).ok).toBe(false);
    });

    it('repassa os ids de câmera e tela, e descarta o anúncio malformado', async () => {
      const ana = await inRoom('Ana', 'Sala de estar');
      const bruno = await inRoom('Bruno', 'Sala de estar');
      const media: SignalPayload = { kind: 'media', camera: 'cam-1', screen: 'tela-1' };
      const relayed = nextEvent(bruno.client.socket, 'voice:signal');
      ana.client.socket.emit('voice:signal', { to: bruno.client.user.id, signal: media });
      expect((await relayed).signal).toEqual(media);

      const nothing = expectNoEvent(bruno.client.socket, 'voice:signal');
      ana.client.socket.emit('voice:signal', {
        to: bruno.client.user.id,
        signal: { kind: 'media', camera: 'x'.repeat(500), screen: '' } as SignalPayload,
      });
      await nothing;
    });
  });

  describe('compartilhamento de tela', () => {
    /** Espera a lista da sala chegar num estado que passe no teste. */
    const roster = (client: TestClient, check: (p: VoiceParticipant[]) => boolean) =>
      nextEvent(client.socket, 'voice:update', (u) => check(u.participants)).then((u) => u.participants);
    const find = (list: VoiceParticipant[], who: TestClient) => list.find((p) => p.userId === who.user.id);

    it('mostra quem está ao vivo e quem assiste, e quem para de transmitir libera quem assistia', async () => {
      const ana = await inRoom('Ana', 'Sala de estar');
      const bruno = await inRoom('Bruno', 'Sala de estar');

      const live = roster(bruno.client, (list) => find(list, ana.client)?.streaming === true);
      ok(await ana.client.socket.emitWithAck('stream:start', { title: '  Fortnite   ' }));
      // O nome do que é compartilhado chega limpo para quem está na sala.
      expect(find(await live, ana.client)?.streamTitle).toBe('Fortnite');

      const watching = roster(ana.client, (list) => find(list, bruno.client)?.watching.includes(ana.client.user.id) === true);
      ok(await bruno.client.socket.emitWithAck('stream:watch', { userId: ana.client.user.id }));
      await watching;

      const ended = roster(bruno.client, (list) => find(list, ana.client)?.streaming === false);
      ana.client.socket.emit('stream:stop');
      expect(find(await ended, bruno.client)?.watching).toEqual([]);
    });

    describe('prévia da transmissão', () => {
      const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBD';

      it('guarda a miniatura mais recente e a entrega a quem pede, sem pôr a imagem na lista da sala', async () => {
        const ana = await inRoom('Ana', 'Sala de estar');
        const bruno = await inRoom('Bruno', 'Sala de estar');
        const { userId } = { userId: ana.client.user.id };

        expect((await bruno.client.socket.emitWithAck('stream:preview:get', { userId })).ok).toBe(false);
        ok(await ana.client.socket.emitWithAck('stream:start', { title: 'Tela 1' }));
        expect(await bruno.client.socket.emitWithAck('stream:preview:get', { userId })).toEqual({
          ok: true,
          data: { image: null },
        });

        ana.client.socket.emit('stream:preview', { image: JPEG });
        await vi.waitFor(async () => {
          expect(await bruno.client.socket.emitWithAck('stream:preview:get', { userId })).toEqual({
            ok: true,
            data: { image: JPEG },
          });
        });

        // Parar a transmissão apaga a miniatura e a prévia deixa de existir.
        ana.client.socket.emit('stream:stop');
        await vi.waitFor(async () => {
          expect((await bruno.client.socket.emitWithAck('stream:preview:get', { userId })).ok).toBe(false);
        });
      });

      it('ignora miniaturas que não são JPEG, e quem não está ao vivo não manda nenhuma', async () => {
        const ana = await inRoom('Ana', 'Sala de estar');
        const bruno = await inRoom('Bruno', 'Sala de estar');
        const { userId } = { userId: ana.client.user.id };

        ana.client.socket.emit('stream:preview', { image: JPEG }); // ainda não está ao vivo
        ok(await ana.client.socket.emitWithAck('stream:start', { title: 'Tela 1' }));
        ana.client.socket.emit('stream:preview', { image: 'data:image/svg+xml;base64,PHN2Zz4=' });
        ana.client.socket.emit('stream:preview', { image: `data:image/jpeg;base64,${'A'.repeat(200_000)}` });
        ana.client.socket.emit('stream:preview', { image: 'data:image/jpeg;base64,<script>' });
        // Dá tempo de o servidor processar (eventos do mesmo socket chegam em ordem).
        expect(await bruno.client.socket.emitWithAck('stream:preview:get', { userId })).toEqual({
          ok: true,
          data: { image: null },
        });
      });

      it('só quem pode entrar no canal vê a prévia', async () => {
        const ana = await inRoom('Ana', 'Sala de estar');
        const fora = await server.connect('Fora');
        ok(await ana.client.socket.emitWithAck('stream:start', { title: 'Tela 1' }));
        // "Fora" ainda não abriu o espaço, mas todo espaço é público: a permissão vem do canal.
        await joinDemoSpace(fora);
        expect((await fora.socket.emitWithAck('stream:preview:get', { userId: ana.client.user.id })).ok).toBe(true);
        expect((await fora.socket.emitWithAck('stream:preview:get', { userId: 'ninguem' })).ok).toBe(false);
      });
    });

    it('quem sai da sala ao vivo também encerra a transmissão para quem assistia', async () => {
      const ana = await inRoom('Ana', 'Sala de estar');
      const bruno = await inRoom('Bruno', 'Sala de estar');
      ok(await ana.client.socket.emitWithAck('stream:start', { title: 'Tela 1' }));
      ok(await bruno.client.socket.emitWithAck('stream:watch', { userId: ana.client.user.id }));

      const cleared = roster(bruno.client, (list) => !find(list, ana.client) && find(list, bruno.client)?.watching.length === 0);
      ana.client.socket.emit('voice:leave');
      await cleared;
    });

    describe('assistir a várias transmissões ao mesmo tempo', () => {
      it('acumula as transmissões, e cada "parar de assistir" tira só a escolhida', async () => {
        const ana = await inRoom('Ana', 'Sala de estar');
        const bia = await inRoom('Bia', 'Sala de estar');
        const caio = await inRoom('Caio', 'Sala de estar');
        const a = ana.client.user.id;
        const b = bia.client.user.id;
        ok(await ana.client.socket.emitWithAck('stream:start', { title: 'Tela A' }));
        ok(await bia.client.socket.emitWithAck('stream:start', { title: 'Tela B' }));

        let seen = roster(ana.client, (list) => find(list, caio.client)?.watching.length === 2);
        ok(await caio.client.socket.emitWithAck('stream:watch', { userId: a }));
        ok(await caio.client.socket.emitWithAck('stream:watch', { userId: b }));
        expect(find(await seen, caio.client)?.watching).toEqual([a, b]);

        // Pedir de novo a mesma não duplica.
        ok(await caio.client.socket.emitWithAck('stream:watch', { userId: a }));

        seen = roster(ana.client, (list) => find(list, caio.client)?.watching.length === 1);
        caio.client.socket.emit('stream:unwatch', { userId: a });
        expect(find(await seen, caio.client)?.watching).toEqual([b]);

        // Sem `userId` (site antigo), para de assistir a todas.
        seen = roster(ana.client, (list) => find(list, caio.client)?.watching.length === 0);
        caio.client.socket.emit('stream:unwatch');
        await seen;
      });

      it('quando uma das transmissões acaba, só ela sai da lista de quem assistia', async () => {
        const ana = await inRoom('Ana', 'Sala de estar');
        const bia = await inRoom('Bia', 'Sala de estar');
        const caio = await inRoom('Caio', 'Sala de estar');
        ok(await ana.client.socket.emitWithAck('stream:start', { title: 'Tela A' }));
        ok(await bia.client.socket.emitWithAck('stream:start', { title: 'Tela B' }));
        ok(await caio.client.socket.emitWithAck('stream:watch', { userId: ana.client.user.id }));
        ok(await caio.client.socket.emitWithAck('stream:watch', { userId: bia.client.user.id }));

        const ended = roster(caio.client, (list) => find(list, ana.client)?.streaming === false);
        ana.client.socket.emit('stream:stop');
        expect(find(await ended, caio.client)?.watching).toEqual([bia.client.user.id]);
      });

      it('limita quantas transmissões a mesma pessoa assiste de uma vez', async () => {
        const watcher = await inRoom('Espectador', 'Sala de estar');
        const streamers: TestClient[] = [];
        for (const name of ['A', 'B', 'C', 'D', 'E']) {
          const s = await inRoom(`Tela ${name}`, 'Sala de estar');
          ok(await s.client.socket.emitWithAck('stream:start', { title: name }));
          streamers.push(s.client);
        }
        for (const s of streamers.slice(0, MAX_WATCHED_STREAMS)) {
          ok(await watcher.client.socket.emitWithAck('stream:watch', { userId: s.user.id }));
        }
        const refused = await watcher.client.socket.emitWithAck('stream:watch', { userId: streamers[MAX_WATCHED_STREAMS].user.id });
        expect(refused.ok).toBe(false);
        // Quem já está na lista pode ser pedida de novo sem esbarrar no limite.
        ok(await watcher.client.socket.emitWithAck('stream:watch', { userId: streamers[0].user.id }));
      });
    });

    it('recusa transmitir fora de uma sala e assistir a quem não está ao vivo, a si mesmo ou em outra sala', async () => {
      const fora = await server.connect('Fora');
      expect((await fora.socket.emitWithAck('stream:start', { title: 'Tela 1' })).ok).toBe(false);

      const ana = await inRoom('Ana', 'Sala de estar');
      const bruno = await inRoom('Bruno', 'Sala de estar');
      const carla = await inRoom('Carla', 'Pareamento');
      expect((await bruno.client.socket.emitWithAck('stream:watch', { userId: ana.client.user.id })).ok).toBe(false);

      ok(await ana.client.socket.emitWithAck('stream:start', { title: 'Tela 1' }));
      expect((await ana.client.socket.emitWithAck('stream:watch', { userId: ana.client.user.id })).ok).toBe(false);
      expect((await carla.client.socket.emitWithAck('stream:watch', { userId: ana.client.user.id })).ok).toBe(false);
      expect((await fora.socket.emitWithAck('stream:watch', { userId: ana.client.user.id })).ok).toBe(false);
    });

    it('exige a permissão de transmitir no canal', async () => {
      const ana = await inRoom('Ana', 'Sala de estar');
      const sala = channelNamed(await joinDemoSpace(ana.client), 'Sala de estar');
      // Tira STREAM do @everyone nesta sala, direto no banco, e recarrega o servidor.
      await server.db.permissionOverwrite.create({
        data: { channelId: sala.id, targetType: 'ROLE', targetId: sala.spaceId, deny: BigInt(Permission.STREAM) },
      });
      await server.restart();
      const again = await server.connectWithToken(ana.client.token);
      await joinDemoSpace(again);
      ok(await again.socket.emitWithAck('voice:join', { channelId: sala.id }));
      expect(await again.socket.emitWithAck('stream:start', { title: 'Tela 1' })).toEqual({
        ok: false,
        error: 'Você não tem permissão para compartilhar a tela neste canal.',
      });
      // A mesma permissão vale para a câmera; desligar continua permitido.
      expect((await again.socket.emitWithAck('voice:video', { enabled: true })).ok).toBe(false);
      ok(await again.socket.emitWithAck('voice:video', { enabled: false }));
      await server.db.permissionOverwrite.deleteMany({ where: { channelId: sala.id } });
      await server.restart();
    });
  });
});

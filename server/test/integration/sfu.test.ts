import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Permission } from '../../../shared/src/permissions.js';
import { sfuConfigFromEnv } from '../../src/sfu.js';
import { hasTestDatabase } from '../support/database.js';
import { channelNamed, joinDemoSpace, ok, TestServer } from '../support/harness.js';

const decode = (token: string) =>
  JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as {
    sub: string;
    video: { room: string; canPublish: boolean; canSubscribe: boolean };
  };

describe.skipIf(!hasTestDatabase)('servidor de mídia das transmissões', () => {
  describe('sem LIVEKIT_URL', () => {
    let server: TestServer;
    beforeAll(async () => {
      server = await TestServer.start();
    });
    afterEach(() => server.disconnectAll());
    afterAll(() => server?.stop());

    it('avisa que não há SFU e não entrega token', async () => {
      const ana = await server.connect('Ana');
      const sala = channelNamed(await joinDemoSpace(ana), 'Sala de estar');
      expect(ok(await ana.socket.emitWithAck('voice:join', { channelId: sala.id })).sfu).toBe(false);
      expect(await ana.socket.emitWithAck('sfu:token')).toEqual({ ok: false, error: 'O servidor de mídia não está disponível.' });
    });
  });

  describe('com o servidor de mídia configurado', () => {
    let server: TestServer;
    beforeAll(async () => {
      const sfu = sfuConfigFromEnv({ LIVEKIT_URL: 'wss://livekit.teste', LIVEKIT_API_SECRET: 'segredo' })!;
      server = await TestServer.start({ sfu });
    });
    afterEach(() => server.disconnectAll());
    afterAll(() => server?.stop());

    it('avisa ao entrar na chamada e entrega um token da sala de voz, com direito de enviar', async () => {
      const ana = await server.connect('Ana');
      const sala = channelNamed(await joinDemoSpace(ana), 'Sala de estar');
      expect(ok(await ana.socket.emitWithAck('voice:join', { channelId: sala.id })).sfu).toBe(true);

      const access = ok(await ana.socket.emitWithAck('sfu:token'));
      expect(access.url).toBe('wss://livekit.teste');
      expect(decode(access.token)).toMatchObject({
        sub: ana.user.id,
        video: { room: sala.id, canPublish: true, canSubscribe: true },
      });
    });

    it('não entrega token a quem não está em uma chamada', async () => {
      const ana = await server.connect('Ana');
      await joinDemoSpace(ana);
      expect(await ana.socket.emitWithAck('sfu:token')).toEqual({ ok: false, error: 'Entre em um canal de voz primeiro.' });
    });

    it('a sala do token é a da chamada em que a pessoa está, não a que ela pedir', async () => {
      const ana = await server.connect('Ana');
      const snapshot = await joinDemoSpace(ana);
      const outra = channelNamed(snapshot, 'Pareamento');
      ok(await ana.socket.emitWithAck('voice:join', { channelId: outra.id }));
      expect(decode(ok(await ana.socket.emitWithAck('sfu:token')).token).video.room).toBe(outra.id);
    });

    it('sem a permissão de transmitir no canal, o token só serve para assistir', async () => {
      const ana = await server.connect('Ana');
      const sala = channelNamed(await joinDemoSpace(ana), 'Sala de estar');
      await server.db.permissionOverwrite.create({
        data: { channelId: sala.id, targetType: 'ROLE', targetId: sala.spaceId, deny: BigInt(Permission.STREAM) },
      });
      await server.restart();
      const again = await server.connectWithToken(ana.token);
      await joinDemoSpace(again);
      ok(await again.socket.emitWithAck('voice:join', { channelId: sala.id }));
      expect(decode(ok(await again.socket.emitWithAck('sfu:token')).token).video).toMatchObject({
        canPublish: false,
        canSubscribe: true,
      });
    });
  });
});

import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { accessToken, sfuConfigFromEnv } from '../../src/sfu.js';

const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;

describe('accessToken', () => {
  const grant = { userId: 'ana', channelId: 'sala-1', canPublish: true };

  it('é um JWT HS256 que o LiveKit aceita: chave em iss, identidade em sub, permissões em video', () => {
    const token = accessToken('segredo', 'coreto', grant, 1_700_000_000, 600);
    const [header, payload, signature] = token.split('.');

    expect(decode(header)).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(decode(payload)).toEqual({
      iss: 'coreto',
      sub: 'ana',
      nbf: 1_699_999_990,
      exp: 1_700_000_600,
      video: {
        room: 'sala-1',
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: false,
        canUpdateOwnMetadata: false,
      },
    });
    const expected = createHmac('sha256', 'segredo').update(`${header}.${payload}`).digest('base64url');
    expect(signature).toBe(expected);
  });

  it('quem só assiste recebe um token sem direito de enviar', () => {
    const token = accessToken('segredo', 'coreto', { ...grant, canPublish: false }, 1_700_000_000, 600);
    expect((decode(token.split('.')[1]).video as Record<string, unknown>).canPublish).toBe(false);
  });
});

describe('sfuConfigFromEnv', () => {
  it('sem LIVEKIT_URL, não há servidor de mídia', () => {
    expect(sfuConfigFromEnv({})).toBeNull();
    expect(sfuConfigFromEnv({ LIVEKIT_URL: '  ' })).toBeNull();
  });

  it('assina com o segredo e a chave configurados', () => {
    const config = sfuConfigFromEnv({
      LIVEKIT_URL: 'wss://livekit.exemplo.com',
      LIVEKIT_API_KEY: 'minha-chave',
      LIVEKIT_API_SECRET: 'segredo',
      LIVEKIT_TOKEN_TTL_SECONDS: '60',
    })!;
    expect(config.url).toBe('wss://livekit.exemplo.com');
    expect(config.ready()).toBe(true);
    const payload = decode(config.token({ userId: 'ana', channelId: 'sala', canPublish: false }, 1_700_000_000_000).split('.')[1]);
    expect(payload).toMatchObject({ iss: 'minha-chave', sub: 'ana', exp: 1_700_000_060 });
  });

  it('lê o segredo de um arquivo quando ele aparece', () => {
    const dir = mkdtempSync(join(tmpdir(), 'coreto-sfu-'));
    const file = join(dir, 'segredo');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const config = sfuConfigFromEnv({ LIVEKIT_URL: 'wss://x', LIVEKIT_SECRET_FILE: file })!;
      // Arquivo ainda não existe: sem SFU por enquanto, sem derrubar o servidor.
      expect(config.ready()).toBe(false);
      expect(() => config.token({ userId: 'ana', channelId: 'sala', canPublish: true })).toThrow(/segredo/);
      writeFileSync(file, 'segredo\n');
      expect(config.ready()).toBe(true);
      const [header, payload, signature] = config.token({ userId: 'ana', channelId: 'sala', canPublish: true }).split('.');
      expect(signature).toBe(createHmac('sha256', 'segredo').update(`${header}.${payload}`).digest('base64url'));
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('recusa configurações incompletas', () => {
    expect(() => sfuConfigFromEnv({ LIVEKIT_URL: 'wss://x' })).toThrow(/LIVEKIT_API_SECRET/);
    expect(() => sfuConfigFromEnv({ LIVEKIT_URL: 'https://x', LIVEKIT_API_SECRET: 's' })).toThrow(/wss/);
    expect(() => sfuConfigFromEnv({ LIVEKIT_URL: 'wss://x', LIVEKIT_API_SECRET: 's', LIVEKIT_TOKEN_TTL_SECONDS: '0' })).toThrow();
  });
});

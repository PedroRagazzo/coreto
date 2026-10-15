import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { iceConfigFromEnv, turnCredentials } from '../../src/turn.js';

describe('turnCredentials', () => {
  it('segue o formato do coturn (conferido com openssl)', () => {
    // printf '1700000000:ana' | openssl dgst -sha1 -hmac segredo -binary | base64
    expect(turnCredentials('segredo', 'ana', 1_700_000_000)).toEqual({
      username: '1700000000:ana',
      credential: 'SrmCfwL1NEeme25PEvh3+kCYiMU=',
    });
  });
});

describe('iceConfigFromEnv', () => {
  it('sem configuração, usa só STUN', () => {
    const config = iceConfigFromEnv({});
    expect(config.iceServers('ana')).toEqual([{ urls: 'stun:stun.l.google.com:19302' }]);
    expect(config.transportPolicy).toBe('all');
  });

  it('com TURN_SECRET, gera credenciais por usuário que expiram', () => {
    const config = iceConfigFromEnv({
      TURN_URLS: 'turn:turn.exemplo.com:3478, turns:turn.exemplo.com:5349',
      TURN_SECRET: 'segredo',
      TURN_TTL_SECONDS: '600',
    });
    const [stun, turn] = config.iceServers('ana', 1_699_999_400_000);
    expect(stun.urls).toBe('stun:stun.l.google.com:19302');
    expect(turn).toEqual({
      urls: ['turn:turn.exemplo.com:3478', 'turns:turn.exemplo.com:5349'],
      username: '1700000000:ana',
      credential: 'SrmCfwL1NEeme25PEvh3+kCYiMU=',
    });
  });

  it('lê o segredo de um arquivo quando ele aparece', () => {
    const dir = mkdtempSync(join(tmpdir(), 'coreto-turn-'));
    const file = join(dir, 'segredo');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const config = iceConfigFromEnv({ TURN_URLS: 'turn:x:3478', TURN_SECRET_FILE: file, TURN_TTL_SECONDS: '600' });
      // Arquivo ainda não existe: só STUN, sem quebrar a chamada.
      expect(config.iceServers('ana', 1_699_999_400_000)).toHaveLength(1);
      writeFileSync(file, 'segredo\n');
      expect(config.iceServers('ana', 1_699_999_400_000)[1]).toMatchObject({
        username: '1700000000:ana',
        credential: 'SrmCfwL1NEeme25PEvh3+kCYiMU=',
      });
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('recusa configurações incompletas', () => {
    expect(() => iceConfigFromEnv({ TURN_URLS: 'turn:x:3478' })).toThrow(/TURN_SECRET/);
    expect(() => iceConfigFromEnv({ ICE_TRANSPORT_POLICY: 'relay' })).toThrow(/relay/);
    expect(() => iceConfigFromEnv({ TURN_URLS: 'turn:x', TURN_SECRET: 's', TURN_TTL_SECONDS: 'nunca' })).toThrow();
  });

  it('aceita relay com TURN fixo em ICE_SERVERS', () => {
    const fixed = [{ urls: 'turn:x:3478', username: 'u', credential: 'c' }];
    const config = iceConfigFromEnv({ ICE_SERVERS: JSON.stringify(fixed), ICE_TRANSPORT_POLICY: 'relay' });
    expect(config.transportPolicy).toBe('relay');
    expect(config.iceServers('ana')).toEqual(fixed);
  });
});

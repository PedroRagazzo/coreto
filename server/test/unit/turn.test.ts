import { describe, expect, it } from 'vitest';
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

// Servidores ICE entregues a quem entra numa sala de voz.
//
// STUN basta na mesma rede ou com NATs simples. Atrás de NAT simétrico ou de
// firewall corporativo, o áudio só passa por um servidor TURN. Com coturn em
// `use-auth-secret`, o servidor gera credenciais temporárias por usuário
// (padrão "TURN REST API"): o segredo nunca vai para o navegador.
//
//   ICE_SERVERS          JSON com servidores fixos (padrão: STUN do Google)
//   TURN_URLS            ex.: "turn:turn.exemplo.com:3478,turns:turn.exemplo.com:5349"
//   TURN_SECRET          o mesmo `static-auth-secret` do coturn
//   TURN_TTL_SECONDS     validade das credenciais (padrão: 1 dia)
//   ICE_TRANSPORT_POLICY "relay" força tudo pelo TURN (para testar o TURN)

import { createHmac } from 'node:crypto';
import type { Id } from '../../shared/src/models.js';
import type { IceServer } from '../../shared/src/protocol.js';

const DEFAULT_ICE_SERVERS: IceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
const DEFAULT_TTL_SECONDS = 24 * 60 * 60;

export interface IceConfig {
  iceServers(userId: Id, now?: number): IceServer[];
  transportPolicy: 'all' | 'relay';
}

/** Lê a configuração das variáveis de ambiente; falha cedo se estiverem malformadas. */
export function iceConfigFromEnv(env: NodeJS.ProcessEnv = process.env): IceConfig {
  const fixed = env.ICE_SERVERS ? (JSON.parse(env.ICE_SERVERS) as IceServer[]) : DEFAULT_ICE_SERVERS;
  if (!Array.isArray(fixed)) throw new Error('ICE_SERVERS precisa ser uma lista JSON.');

  const turnUrls = (env.TURN_URLS ?? '').split(',').map((url) => url.trim()).filter(Boolean);
  const secret = env.TURN_SECRET ?? '';
  if (turnUrls.length > 0 && !secret) throw new Error('TURN_URLS definido sem TURN_SECRET.');
  const ttl = Number(env.TURN_TTL_SECONDS ?? DEFAULT_TTL_SECONDS);
  if (!Number.isFinite(ttl) || ttl <= 0) throw new Error('TURN_TTL_SECONDS precisa ser um número positivo.');

  const transportPolicy = env.ICE_TRANSPORT_POLICY === 'relay' ? 'relay' : 'all';
  if (transportPolicy === 'relay' && turnUrls.length === 0 && !fixed.some(isTurn)) {
    throw new Error('ICE_TRANSPORT_POLICY=relay sem nenhum servidor TURN configurado.');
  }

  return {
    transportPolicy,
    iceServers(userId, now = Date.now()) {
      if (turnUrls.length === 0) return fixed;
      return [...fixed, { urls: turnUrls, ...turnCredentials(secret, userId, Math.floor(now / 1000) + ttl) }];
    },
  };
}

/** Credencial temporária do coturn: usuário "expiração:id", senha = base64(HMAC-SHA1(segredo, usuário)). */
export function turnCredentials(secret: string, userId: Id, expiresAt: number): { username: string; credential: string } {
  const username = `${expiresAt}:${userId}`;
  return { username, credential: createHmac('sha1', secret).update(username).digest('base64') };
}

const isTurn = (server: IceServer) =>
  [server.urls].flat().some((url) => url.startsWith('turn:') || url.startsWith('turns:'));

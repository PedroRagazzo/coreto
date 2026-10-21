// Servidor de mídia (SFU) para a transmissão de tela.
//
// Na malha P2P, quem transmite codifica e envia uma cópia do vídeo para cada espectador. Com um SFU
// (LiveKit, ver deploy/livekit) ele envia uma cópia só, e o servidor a reparte. A voz continua P2P.
//
// O servidor Node não fala com o LiveKit: só assina tokens de acesso (JWT HS256, o formato do LiveKit)
// que o navegador usa para entrar na sala da chamada. Por isso não precisa do SDK do LiveKit.
//
//   LIVEKIT_URL          endereço wss:// que o navegador usa (ex.: wss://livekit.exemplo.com). Sem ele, sem SFU.
//   LIVEKIT_API_KEY      nome da chave (padrão: coreto; não é segredo)
//   LIVEKIT_API_SECRET   o segredo da chave
//   LIVEKIT_SECRET_FILE  ou um arquivo com o segredo (ex.: volume gerado por deploy/livekit)
//   LIVEKIT_TOKEN_TTL_SECONDS  validade do token (padrão: 2 horas)

import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Id } from '../../shared/src/models.js';

const DEFAULT_API_KEY = 'coreto';
const DEFAULT_TTL_SECONDS = 2 * 60 * 60;

export interface SfuConfig {
  /** Endereço wss:// do LiveKit para o navegador. */
  url: string;
  /** Falso enquanto o segredo ainda não existe (o LiveKit de deploy gera na primeira subida). */
  ready(): boolean;
  /** Token para entrar na sala da chamada; só quem tem `canPublish` pode enviar vídeo. */
  token(grant: SfuGrant, now?: number): string;
}

export interface SfuGrant {
  userId: Id;
  /** A sala do LiveKit é a sala de voz. */
  channelId: Id;
  canPublish: boolean;
}

/** Lê a configuração das variáveis de ambiente; sem `LIVEKIT_URL` não há SFU (`null`). */
export function sfuConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SfuConfig | null {
  const url = env.LIVEKIT_URL?.trim();
  if (!url) return null;
  if (!/^wss?:\/\//.test(url)) throw new Error('LIVEKIT_URL precisa começar com wss:// (ou ws:// em testes).');
  const apiKey = env.LIVEKIT_API_KEY?.trim() || DEFAULT_API_KEY;
  const secret = env.LIVEKIT_API_SECRET
    ? () => env.LIVEKIT_API_SECRET!
    : env.LIVEKIT_SECRET_FILE
      ? secretFromFile(env.LIVEKIT_SECRET_FILE)
      : null;
  if (!secret) throw new Error('LIVEKIT_URL definido sem LIVEKIT_API_SECRET nem LIVEKIT_SECRET_FILE.');
  const ttl = Number(env.LIVEKIT_TOKEN_TTL_SECONDS ?? DEFAULT_TTL_SECONDS);
  if (!Number.isFinite(ttl) || ttl <= 0) throw new Error('LIVEKIT_TOKEN_TTL_SECONDS precisa ser um número positivo.');

  return {
    url,
    ready: () => secret() !== null,
    token(grant, now = Date.now()) {
      const key = secret();
      if (!key) throw new Error('O segredo do LiveKit ainda não existe.');
      return accessToken(key, apiKey, grant, Math.floor(now / 1000), ttl);
    },
  };
}

/** Lê o segredo do arquivo na primeira vez que ele existir; antes disso, `null` (e um aviso no log). */
function secretFromFile(path: string): () => string | null {
  let cached: string | null = null;
  let warned = false;
  return () => {
    if (cached) return cached;
    try {
      cached = readFileSync(path, 'utf8').trim() || null;
    } catch (err) {
      if (!warned) console.warn(`[sfu] sem segredo em ${path}; transmissões seguem pela malha P2P por enquanto.`, (err as Error).message);
      warned = true;
    }
    return cached;
  };
}

const base64url = (data: string | Buffer) => Buffer.from(data).toString('base64url');

/** JWT HS256 no formato de acesso do LiveKit: `sub` é a identidade, `video` traz as permissões na sala. */
export function accessToken(secret: string, apiKey: string, grant: SfuGrant, nowSeconds: number, ttlSeconds: number): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      iss: apiKey,
      sub: grant.userId,
      nbf: nowSeconds - 10,
      exp: nowSeconds + ttlSeconds,
      video: {
        room: grant.channelId,
        roomJoin: true,
        canPublish: grant.canPublish,
        canSubscribe: true,
        canPublishData: false,
        canUpdateOwnMetadata: false,
      },
    }),
  );
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest();
  return `${header}.${payload}.${base64url(signature)}`;
}

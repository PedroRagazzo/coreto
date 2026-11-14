// Limites de ritmo: quantas vezes por janela de tempo cada pessoa (ou cada endereço) pode fazer uma coisa.
//
// Os números são folgados de propósito: quem usa o Coreto de verdade (digitando, clicando, entrando na chamada) nunca os
// vê. Eles só barram um programa soltando milhares de pedidos por segundo, que encheria o banco de mensagens, contas e
// espaços ou travaria o servidor. Ficam em memória; reiniciar o servidor zera.

import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';

export interface RateRule {
  /** Quantos eventos cabem dentro da janela. */
  max: number;
  windowMs: number;
}

/** A cada tantas chamadas, esquece quem ficou quieto (senão o mapa cresceria com cada pessoa e endereço que já passou). */
const SWEEP_EVERY = 500;

/** Janela deslizante por chave: aceita um evento se, para cada regra, ainda houver espaço na janela dela. */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly longest: number;
  private calls = 0;

  constructor(
    private readonly rules: readonly RateRule[],
    private readonly clock: () => number = Date.now,
  ) {
    this.longest = Math.max(...rules.map((rule) => rule.windowMs));
  }

  /**
   * Diz se mais um evento de `key` cabe agora e, se couber, já o conta. O recusado não conta: quem insiste fica bloqueado
   * só até a janela abrir, e o servidor não guarda um registro para cada tentativa de uma enxurrada.
   */
  take(key: string): boolean {
    const now = this.clock();
    const times = this.hits.get(key) ?? [];
    while (times.length > 0 && now - times[0]! >= this.longest) times.shift();
    for (const { max, windowMs } of this.rules) {
      let inside = 0;
      for (let i = times.length - 1; i >= 0 && now - times[i]! < windowMs; i--) inside++;
      if (inside >= max) return false;
    }
    times.push(now);
    this.hits.set(key, times);
    if (++this.calls % SWEEP_EVERY === 0) this.sweep(now);
    return true;
  }

  /** Quantas chaves estão guardadas (para os testes verificarem que o mapa não cresce sem fim). */
  get size(): number {
    return this.hits.size;
  }

  private sweep(now: number): void {
    for (const [key, times] of this.hits) {
      if (times.length === 0 || now - times[times.length - 1]! >= this.longest) this.hits.delete(key);
    }
  }
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

const limiter = (...rules: Array<[max: number, windowMs: number]>) =>
  new RateLimiter(rules.map(([max, windowMs]) => ({ max, windowMs })));

/**
 * Todos os limites do servidor. Os "por pessoa" usam o id do usuário como chave (valem para todas as abas e janelas dela
 * juntas: abrir mais conexões não dá mais direito a nada); os "por endereço" usam o IP de quem chamou.
 */
export function createRateLimits() {
  return {
    // ── Por pessoa ──────────────────────────────────────────────────────────────
    /** Mensagens, enquetes e roletas novas. */
    post: limiter([30, 10 * SECOND], [200, 5 * MINUTE]),
    /** Editar e apagar mensagens. */
    edit: limiter([30, 10 * SECOND]),
    reaction: limiter([20, 5 * SECOND]),
    /** Votar, encerrar enquete, girar roleta e fixar. */
    pollAction: limiter([30, 5 * SECOND]),
    /** Ler do banco: histórico, contexto de uma mensagem, fixadas, sons e prévia de transmissão. */
    read: limiter([40, 10 * SECOND]),
    search: limiter([10, 10 * SECOND]),
    /** "Li até aqui" e "vi as menções". */
    readMark: limiter([60, 10 * SECOND]),
    typing: limiter([15, 10 * SECOND]),
    presence: limiter([10, 10 * SECOND]),
    /** Cartões de pré-visualização de links (cada um pode visitar um site). */
    linkPreview: limiter([40, 10 * SECOND]),
    /** Pedidos ao bot de música (cada um pode abrir um processo para buscar a música). */
    music: limiter([12, 5 * SECOND], [120, 5 * MINUTE]),
    /** Editar e apagar espaços e canais, e criar canais. */
    manage: limiter([30, MINUTE]),
    createSpace: limiter([5, 10 * MINUTE]),
    openDirect: limiter([30, MINUTE]),
    voiceJoin: limiter([10, 30 * SECOND]),
    /** Mutar, câmera, começar a transmitir e assistir: cada um avisa a sala inteira. */
    voiceState: limiter([40, 10 * SECOND]),
    /** Repasse de SDP e candidatos ICE: uma chamada cheia manda algumas centenas ao entrar. */
    voiceSignal: limiter([600, 10 * SECOND]),
    sfuToken: limiter([10, MINUTE]),
    /** Diagnóstico de conexão: cinco pedidos por teste, e o teste leva alguns segundos. */
    ping: limiter([40, MINUTE]),
    iceInfo: limiter([10, MINUTE]),

    // ── Por endereço ────────────────────────────────────────────────────────────
    /** Pedidos de login (cada um confere um PIN com scrypt, que gasta processador). */
    login: limiter([30, MINUTE]),
    /** Contas novas criadas a partir de um mesmo endereço... */
    newAccountByAddress: limiter([15, HOUR]),
    /** ...e no servidor todo, para um bando de endereços não encher o banco de contas. */
    newAccountAnywhere: limiter([100, HOUR]),
  };
}

export type RateLimits = ReturnType<typeof createRateLimits>;

/** Quantas janelas e abas uma mesma conta mantém conectadas ao mesmo tempo; passou disso, a conexão nova é recusada. */
export const MAX_SOCKETS_PER_USER = 20;

/** Resposta de ack quando a pessoa passou do ritmo. */
export const TOO_FAST = { ok: false, error: 'Devagar: muitas ações seguidas. Espere um instante.' } as const;

// ── Endereço de quem chamou ──────────────────────────────────────────────────

/** Tira o prefixo de IPv4 dentro de IPv6 (`::ffff:1.2.3.4`) para o mesmo endereço ter uma só grafia. */
function normalizeAddress(address: string): string {
  return address.replace(/^::ffff:/i, '');
}

/** Endereços de dentro da própria máquina ou da rede privada (onde ficam o proxy do Dokploy e o Docker). */
function isPrivateAddress(address: string): boolean {
  if (isLoopbackAddress(address)) return true;
  if (isIP(address) === 6) return /^(fc|fd|fe80)/i.test(address);
  const [a = 0, b = 0] = address.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

/** O próprio computador: no desenvolvimento e nos testes todo mundo chega daqui, então nada disso vale ali. */
export function isLoopbackAddress(address: string): boolean {
  return address === '::1' || address.startsWith('127.');
}

/**
 * O endereço de quem fez o pedido. Atrás do proxy do servidor (que fica na rede privada) o endereço de verdade vem em
 * `X-Forwarded-For`, e o proxy acrescenta o dele no fim da lista: vale o último. De fora da rede privada ninguém é
 * proxy, então o cabeçalho é ignorado (senão qualquer um escolheria o próprio endereço).
 */
export function clientAddress(req: IncomingMessage): string {
  const remote = normalizeAddress(req.socket.remoteAddress ?? '');
  if (!isPrivateAddress(remote)) return remote;
  const header = req.headers['x-forwarded-for'];
  const forwarded = (Array.isArray(header) ? header.join(',') : (header ?? ''))
    .split(',')
    .map((part) => normalizeAddress(part.trim()))
    .filter(Boolean)
    .pop();
  return forwarded && isIP(forwarded) !== 0 ? forwarded : remote;
}

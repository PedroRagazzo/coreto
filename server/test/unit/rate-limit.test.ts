import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { clientAddress, createRateLimits, isLoopbackAddress, RateLimiter } from '../../src/rate-limit.js';

/** Um relógio que só anda quando o teste manda. */
function fakeClock(start = 1_000_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => void (now += ms) };
}

describe('RateLimiter', () => {
  it('deixa passar até o máximo da janela e recusa o resto', () => {
    const clock = fakeClock();
    const limiter = new RateLimiter([{ max: 3, windowMs: 1000 }], clock.now);
    expect([1, 2, 3, 4, 5].map(() => limiter.take('ana'))).toEqual([true, true, true, false, false]);
  });

  it('libera de novo quando a janela passa', () => {
    const clock = fakeClock();
    const limiter = new RateLimiter([{ max: 2, windowMs: 1000 }], clock.now);
    limiter.take('ana');
    limiter.take('ana');
    expect(limiter.take('ana')).toBe(false);
    clock.advance(1000);
    expect(limiter.take('ana')).toBe(true);
  });

  it('conta cada chave em separado', () => {
    const limiter = new RateLimiter([{ max: 1, windowMs: 1000 }], fakeClock().now);
    expect(limiter.take('ana')).toBe(true);
    expect(limiter.take('ana')).toBe(false);
    expect(limiter.take('bruno')).toBe(true);
  });

  it('respeita todas as regras: a rajada curta e o total mais longo', () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(
      [
        { max: 2, windowMs: 1000 },
        { max: 3, windowMs: 10_000 },
      ],
      clock.now,
    );
    expect(limiter.take('ana')).toBe(true);
    expect(limiter.take('ana')).toBe(true);
    clock.advance(1100); // a rajada abriu, mas o total de 10 s ainda tem espaço para só mais um
    expect(limiter.take('ana')).toBe(true);
    clock.advance(1100);
    expect(limiter.take('ana')).toBe(false); // 3 nos últimos 10 s
    clock.advance(9000); // os 3 saíram da janela longa
    expect(limiter.take('ana')).toBe(true);
  });

  it('o pedido recusado não conta: insistir não prolonga o bloqueio', () => {
    const clock = fakeClock();
    const limiter = new RateLimiter([{ max: 1, windowMs: 1000 }], clock.now);
    limiter.take('ana');
    for (let i = 0; i < 50; i++) {
      clock.advance(10);
      expect(limiter.take('ana')).toBe(false);
    }
    clock.advance(500); // 1 s depois do único pedido aceito
    expect(limiter.take('ana')).toBe(true);
  });

  it('esquece quem ficou quieto, para o mapa não crescer sem fim', () => {
    const clock = fakeClock();
    const limiter = new RateLimiter([{ max: 5, windowMs: 1000 }], clock.now);
    for (let i = 0; i < 400; i++) limiter.take(`conta-${i}`);
    expect(limiter.size).toBe(400);
    clock.advance(2000);
    // A faxina roda a cada 500 pedidos aceitos: sobram só os 100 recém-chegados.
    for (let i = 0; i < 100; i++) limiter.take(`nova-${i}`);
    expect(limiter.size).toBe(100);
  });
});

describe('createRateLimits', () => {
  it('é folgado para quem usa de verdade: dá para mandar uma rajada de mensagens e de reações', () => {
    const limits = createRateLimits();
    expect(Array.from({ length: 20 }, () => limits.post.take('ana')).every(Boolean)).toBe(true);
    expect(Array.from({ length: 15 }, () => limits.reaction.take('ana')).every(Boolean)).toBe(true);
  });

  it('barra uma enxurrada de mensagens', () => {
    const limits = createRateLimits();
    const accepted = Array.from({ length: 1000 }, () => limits.post.take('ana')).filter(Boolean).length;
    expect(accepted).toBeLessThanOrEqual(30);
  });
});

/** Um pedido falso: só o endereço de quem conectou e o cabeçalho de repasse importam. */
const request = (remote: string | undefined, forwarded?: string | string[]) =>
  ({ socket: { remoteAddress: remote }, headers: forwarded === undefined ? {} : { 'x-forwarded-for': forwarded } }) as unknown as IncomingMessage;

describe('clientAddress', () => {
  it('usa o endereço de quem conectou quando ele é público, ignorando o cabeçalho (senão qualquer um escolheria o seu)', () => {
    expect(clientAddress(request('203.0.113.7', '198.51.100.1'))).toBe('203.0.113.7');
  });

  it('atrás do proxy da rede privada, vale o último endereço do cabeçalho (o que o proxy viu)', () => {
    expect(clientAddress(request('172.18.0.4', '198.51.100.1'))).toBe('198.51.100.1');
    expect(clientAddress(request('10.0.0.2', '1.2.3.4, 198.51.100.9'))).toBe('198.51.100.9');
    expect(clientAddress(request('::ffff:192.168.1.5', ['1.2.3.4', '198.51.100.9']))).toBe('198.51.100.9');
    expect(clientAddress(request('::1', '2001:db8::1'))).toBe('2001:db8::1');
  });

  it('sem cabeçalho, ou com lixo nele, fica o endereço de quem conectou', () => {
    expect(clientAddress(request('172.18.0.4'))).toBe('172.18.0.4');
    expect(clientAddress(request('172.18.0.4', 'não é um ip'))).toBe('172.18.0.4');
    expect(clientAddress(request(undefined))).toBe('');
  });

  it('escreve o IPv4 dentro de IPv6 como IPv4', () => {
    expect(clientAddress(request('::ffff:203.0.113.7'))).toBe('203.0.113.7');
  });
});

describe('isLoopbackAddress', () => {
  it('reconhece só o próprio computador', () => {
    expect(['127.0.0.1', '127.1.2.3', '::1'].every(isLoopbackAddress)).toBe(true);
    expect(['10.0.0.1', '172.18.0.4', '203.0.113.7', '::2', ''].some(isLoopbackAddress)).toBe(false);
  });
});

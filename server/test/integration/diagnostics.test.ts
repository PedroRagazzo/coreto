import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDatabase } from '../support/database.js';
import { ok, TestServer } from '../support/harness.js';

// O que o diagnóstico (Configurações, Diagnóstico) pede ao servidor: uma resposta rápida, para medir a ida e volta, e os
// servidores de rede das chamadas, para testar o UDP e o TURN sem entrar numa sala de voz.
describe.skipIf(!hasTestDatabase)('diagnóstico de conexão', () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await TestServer.start();
  });
  afterEach(() => server.disconnectAll());
  afterAll(() => server?.stop());

  it('responde ao ping do site', async () => {
    const ana = await server.connect('Ana');
    expect(await ana.socket.emitWithAck('net:ping')).toEqual({ ok: true, data: null });
  });

  it('entrega os servidores de rede das chamadas, os mesmos que a sala de voz entregaria', async () => {
    const ana = await server.connect('Ana');
    const ice = ok(await ana.socket.emitWithAck('net:ice'));
    expect(ice.iceServers.length).toBeGreaterThan(0);
    expect(ice.iceTransportPolicy).toBe('all');
  });

  it('não deixa ninguém usar isso em enxurrada', async () => {
    const ana = await server.connect('Ana');
    const pings = await Promise.all(Array.from({ length: 80 }, () => ana.socket.emitWithAck('net:ping')));
    expect(pings.filter((p) => p.ok).length).toBeLessThanOrEqual(40);
    expect(pings.some((p) => !p.ok)).toBe(true);

    const ices = await Promise.all(Array.from({ length: 30 }, () => ana.socket.emitWithAck('net:ice')));
    expect(ices.filter((p) => p.ok).length).toBeLessThanOrEqual(10);
  });
});

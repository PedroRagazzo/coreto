// Limites de ritmo (server/src/rate-limit.ts): quem usa normalmente nunca esbarra, mas um programa soltando pedidos em
// enxurrada é barrado, e uma pessoa não escapa abrindo mais janelas.

import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDatabase } from '../support/database.js';
import { channelNamed, DEFAULT_PIN, joinDemoSpace, ok, TestServer } from '../support/harness.js';

describe.skipIf(!hasTestDatabase)('limites de ritmo', () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await TestServer.start();
  });
  afterEach(() => server.disconnectAll());
  afterAll(() => server?.stop());

  // Cada teste usa o seu próprio "endereço" (por trás de um proxy), para os limites por endereço não se misturarem.
  let nextAddress = 10;
  const newAddress = () => `203.0.113.${nextAddress++}`;

  describe('mensagens', () => {
    it('barra uma enxurrada de mensagens de uma pessoa, sem afetar as outras', async () => {
      const ana = await server.connect('Ana');
      const bruno = await server.connect('Bruno');
      const geral = channelNamed(await joinDemoSpace(ana), 'geral');
      await joinDemoSpace(bruno);

      const answers = await Promise.all(
        Array.from({ length: 80 }, (_, i) => ana.socket.emitWithAck('message:send', { channelId: geral.id, content: `spam ${i}` })),
      );
      const accepted = answers.filter((a) => a.ok).length;
      expect(accepted).toBeGreaterThan(0);
      expect(accepted).toBeLessThanOrEqual(30);
      expect(answers.filter((a) => !a.ok)).toEqual(
        Array.from({ length: 80 - accepted }, () => ({ ok: false, error: 'Devagar: muitas ações seguidas. Espere um instante.' })),
      );

      // O Bruno escreve normalmente.
      ok(await bruno.socket.emitWithAck('message:send', { channelId: geral.id, content: 'oi' }));
    });

    it('uma pessoa normal, mandando 20 mensagens em sequência, não esbarra em nada', async () => {
      const ana = await server.connect('Ana');
      const geral = channelNamed(await joinDemoSpace(ana), 'geral');
      for (let i = 0; i < 20; i++) ok(await ana.socket.emitWithAck('message:send', { channelId: geral.id, content: `n${i}` }));
    });

    it('o limite é da pessoa, não da janela: abrir outra aba não dá direito a mais', async () => {
      const ana = await server.connect('Ana');
      const second = await server.connectWithToken(ana.token);
      const geral = channelNamed(await joinDemoSpace(ana), 'geral');
      await joinDemoSpace(second);

      const answers = await Promise.all(
        [ana, second].flatMap((tab) =>
          Array.from({ length: 30 }, (_, i) => tab.socket.emitWithAck('message:send', { channelId: geral.id, content: `aba ${i}` })),
        ),
      );
      expect(answers.filter((a) => a.ok).length).toBeLessThanOrEqual(30);
    });

    it('também vale para enquetes e para editar e apagar mensagens', async () => {
      const ana = await server.connect('Ana');
      const geral = channelNamed(await joinDemoSpace(ana), 'geral');
      const polls = await Promise.all(
        Array.from({ length: 50 }, () => ana.socket.emitWithAck('poll:create', { channelId: geral.id, question: 'Pizza?', options: ['sim', 'não'] })),
      );
      expect(polls.filter((p) => !p.ok).length).toBeGreaterThan(0);

      const bruno = await server.connect('Bruno');
      const bGeral = channelNamed(await joinDemoSpace(bruno), 'geral');
      const message = ok(await bruno.socket.emitWithAck('message:send', { channelId: bGeral.id, content: 'editável' }));
      const edits = await Promise.all(
        Array.from({ length: 60 }, (_, i) => bruno.socket.emitWithAck('message:edit', { messageId: message.id, content: `versão ${i}` })),
      );
      expect(edits.filter((e) => e.ok).length).toBeLessThanOrEqual(30);
      expect(edits.some((e) => !e.ok)).toBe(true);
    });
  });

  describe('o resto do servidor', () => {
    it('barra a busca em enxurrada (ela varre o banco)', async () => {
      const ana = await server.connect('Ana');
      const space = ana.spaces.find((s) => s.name === 'Coreto Dev')!;
      const answers = await Promise.all(
        Array.from({ length: 40 }, () => ana.socket.emitWithAck('message:search', { text: 'coreto', scope: { spaceId: space.id } })),
      );
      expect(answers.filter((a) => a.ok).length).toBeLessThanOrEqual(10);
      expect(answers.some((a) => !a.ok && a.error.startsWith('Devagar'))).toBe(true);
    });

    it('cada pessoa cria no máximo 5 espaços em 10 minutos', async () => {
      const ana = await server.connect('Ana');
      for (let i = 1; i <= 5; i++) ok(await ana.socket.emitWithAck('space:create', { name: `Espaço ${i}` }));
      const sixth = await ana.socket.emitWithAck('space:create', { name: 'Espaço 6' });
      expect(sixth).toEqual({ ok: false, error: 'Você criou espaços demais agora. Espere alguns minutos.' });

      // Quem cria o primeiro espaço não é afetado pelo limite da Ana.
      const bruno = await server.connect('Bruno');
      ok(await bruno.socket.emitWithAck('space:create', { name: 'Espaço do Bruno' }));
    });

    it('entrar em salas de voz em enxurrada é recusado depois de 10 vezes em 30 segundos', async () => {
      const ana = await server.connect('Ana');
      const sala = channelNamed(await joinDemoSpace(ana), 'Sala de estar');
      const answers = [];
      for (let i = 0; i < 14; i++) answers.push(await ana.socket.emitWithAck('voice:join', { channelId: sala.id }));
      expect(answers.filter((a) => a.ok)).toHaveLength(10);
      expect(answers.slice(10).every((a) => !a.ok)).toBe(true);
    });

    it('mutar e desmutar em enxurrada não vira uma enxurrada de avisos para a sala', async () => {
      const ana = await server.connect('Ana');
      const bruno = await server.connect('Bruno');
      const salaA = channelNamed(await joinDemoSpace(ana), 'Sala de estar');
      await joinDemoSpace(bruno);
      ok(await ana.socket.emitWithAck('voice:join', { channelId: salaA.id }));
      ok(await bruno.socket.emitWithAck('voice:join', { channelId: salaA.id }));

      let updates = 0;
      bruno.socket.on('voice:update', () => updates++);
      for (let i = 0; i < 200; i++) ana.socket.emit('voice:state', { muted: i % 2 === 0, deafened: false });
      await new Promise((resolve) => setTimeout(resolve, 600));
      expect(updates).toBeGreaterThan(0);
      expect(updates).toBeLessThanOrEqual(40);
    });
  });

  describe('contas e conexões', () => {
    it('um endereço cria no máximo 15 contas novas por hora, mas quem já tem conta continua entrando', async () => {
      const address = newAddress();
      const first = await server.login('Conta Nova 0', DEFAULT_PIN, address);
      expect(first.status).toBe(200);
      for (let i = 1; i < 15; i++) expect((await server.login(`Conta Nova ${i}`, DEFAULT_PIN, address)).status).toBe(200);

      const blocked = await server.login('Conta Nova 15', DEFAULT_PIN, address);
      expect(blocked).toMatchObject({ status: 429, body: { ok: false, code: 'rate_limited' } });
      // A conta não foi criada: de outro endereço o mesmo nome ainda está livre.
      expect(await server.login('Conta Nova 15', DEFAULT_PIN, newAddress())).toMatchObject({ status: 200, body: { ok: true, created: true } });

      // Entrar numa conta que já existe não é "conta nova": segue funcionando.
      expect(await server.login('Conta Nova 3', DEFAULT_PIN, address)).toMatchObject({ status: 200, body: { ok: true, created: false } });
    });

    it('um mesmo endereço pode fazer no máximo 30 pedidos de login por minuto, certos ou errados', async () => {
      const address = newAddress();
      await server.login('Quem Erra', DEFAULT_PIN, address);
      const statuses: number[] = [];
      // Nomes diferentes, para o bloqueio por nome (5 erros) não aparecer antes do limite por endereço.
      for (let i = 0; i < 40; i++) statuses.push((await server.login(`Inexistente ${address} ${i}`, '12', address)).status);
      expect(statuses.filter((s) => s === 400)).toHaveLength(29); // 30 no total, contando o primeiro
      expect(statuses.filter((s) => s === 429)).toHaveLength(11);
    });

    it('pelo próprio computador (desenvolvimento e testes) nada disso conta', async () => {
      for (let i = 0; i < 40; i++) expect((await server.login(`Local ${i}`, DEFAULT_PIN)).status).toBe(200);
    });

    it('uma conta não mantém mais de 20 janelas abertas ao mesmo tempo', async () => {
      const ana = await server.connect('Ana');
      // A conexão da `connect` já conta uma.
      for (let i = 1; i < 20; i++) await server.connectWithToken(ana.token);
      await expect(server.connectWithToken(ana.token)).rejects.toMatchObject({
        message: 'Esta conta já está aberta em janelas demais. Feche algumas e tente de novo.',
      });

      // Fechando uma, cabe outra; e as outras contas não são afetadas.
      ana.socket.disconnect();
      await new Promise((resolve) => setTimeout(resolve, 200));
      await server.connectWithToken(ana.token);
      await server.connect('Bruno');
    });
  });

  describe('envio de arquivos', () => {
    it('uma pessoa não ocupa todas as vagas de envios em pedaços em andamento', async () => {
      const ana = await server.connect('Ana');
      const bruno = await server.connect('Bruno');
      const first = (token: string) =>
        server.uploadChunk(token, { id: randomUUID(), offset: 0, total: 10_000, data: Buffer.alloc(100, 1) });

      for (let i = 0; i < 12; i++) expect((await first(ana.token)).status).toBe(200);
      expect(await first(ana.token)).toMatchObject({ status: 429, body: { ok: false } });
      // O Bruno ainda tem as vagas dele.
      expect((await first(bruno.token)).status).toBe(200);
    });
  });
});

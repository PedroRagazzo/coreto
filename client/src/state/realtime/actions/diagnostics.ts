// O que o diagnóstico (Configurações, Diagnóstico) pede ao servidor pelo socket.

import type { ActionContext } from '../context';
import { settle } from '../context';
import type { RealtimeActions } from '../types';

/** Quantos pedidos seguidos para medir a ida e volta, e quanto esperar por cada um. */
const PINGS = 5;
const PING_TIMEOUT_MS = 4000;

export function createDiagnosticsActions(ctx: ActionContext): Pick<RealtimeActions, 'probeServer' | 'probeIceServers'> {
  return {
    async probeServer() {
      const socket = ctx.socketRef.current;
      const result = { pingsMs: [] as number[], lost: 0, connected: Boolean(socket?.connected), transport: null as string | null };
      if (!socket?.connected) return result;
      result.transport = socket.io.engine?.transport?.name ?? null;
      // Um de cada vez: cada medida é a de um pedido sozinho na linha.
      for (let i = 0; i < PINGS; i++) {
        const started = performance.now();
        try {
          const res = await socket.timeout(PING_TIMEOUT_MS).emitWithAck('net:ping');
          if (res.ok) result.pingsMs.push(performance.now() - started);
          else result.lost++;
        } catch {
          result.lost++;
        }
      }
      return result;
    },

    async probeIceServers() {
      const socket = ctx.socketRef.current;
      if (!socket) return { ok: false, error: 'Sem conexão com o servidor.' };
      return settle(socket.timeout(8000).emitWithAck('net:ice'));
    },
  };
}

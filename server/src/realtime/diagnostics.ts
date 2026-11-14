// Apoio ao diagnóstico de conexão (Configurações, Diagnóstico): o site mede a ida e volta até aqui e pede os servidores de
// rede das chamadas para testar se o UDP e o servidor de retransmissão (TURN) respondem, sem precisar entrar numa chamada.

import { TOO_FAST, type RateLimits } from '../rate-limit.js';
import type { IceConfig } from '../turn.js';
import { isFunction } from './guards.js';
import type { AppSocket } from './types.js';

export function registerDiagnostics(socket: AppSocket, ice: IceConfig, limits: RateLimits): void {
  const { userId } = socket.data;

  socket.on('net:ping', (ack) => {
    if (!isFunction(ack)) return;
    if (!limits.ping.take(userId)) return ack(TOO_FAST);
    ack({ ok: true, data: null });
  });

  socket.on('net:ice', (ack) => {
    if (!isFunction(ack)) return;
    if (!limits.iceInfo.take(userId)) return ack(TOO_FAST);
    ack({ ok: true, data: { iceServers: ice.iceServers(userId), iceTransportPolicy: ice.transportPolicy } });
  });
}

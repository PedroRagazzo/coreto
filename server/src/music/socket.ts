// O painel de música da sala: pedidos e controles que chegam pelo socket. As regras são as mesmas do chat
// (quem pede precisa estar numa sala de voz; quem controla, na sala do robô) e valem dentro do `MusicBot`;
// aqui só se confere o formato do que veio do cliente.

import type { MusicControl } from '../../../shared/src/protocol.js';
import { isFunction } from '../realtime/guards.js';
import type { AppSocket } from '../realtime/types.js';
import type { RateLimits } from '../rate-limit.js';
import type { MusicBot } from './bot.js';

const MAX_INPUT_LENGTH = 600;
const MAX_ID_LENGTH = 100;
/** Maior ponto de uma música a que o painel pode ir (a duração máxima de uma música já é menor que isso). */
const MAX_SEEK_SECONDS = 24 * 3600;
const SIMPLE_ACTIONS = new Set(['skip', 'pause', 'resume', 'stop', 'clear', 'shuffle']);

/** Confere o formato de um controle vindo do cliente. */
export function readControl(raw: unknown): MusicControl | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { action, id, volume, mode, seconds } = raw as Record<string, unknown>;
  if (typeof action !== 'string') return null;
  if (SIMPLE_ACTIONS.has(action)) return { action: action as 'skip' | 'pause' | 'resume' | 'stop' | 'clear' | 'shuffle' };
  if (action === 'remove' || action === 'top') return typeof id === 'string' && id.length > 0 && id.length <= MAX_ID_LENGTH ? { action, id } : null;
  if (action === 'volume') return typeof volume === 'number' && Number.isFinite(volume) ? { action, volume } : null;
  if (action === 'repeat') return mode === 'off' || mode === 'one' || mode === 'all' ? { action, mode } : null;
  if (action === 'seek') return typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0 && seconds <= MAX_SEEK_SECONDS ? { action, seconds } : null;
  return null;
}

export function registerMusic(socket: AppSocket, getBot: () => MusicBot | null, limits: RateLimits): void {
  const { userId } = socket.data;
  // Um clique nervoso passa, uma enxurrada não (vale para a pessoa toda, não para cada janela dela).
  const tooFast = () => !limits.music.take(userId);
  const NOT_ON = 'O bot de música não está ligado neste servidor.';
  const FAILED = 'Não consegui fazer isso agora. Tente de novo.';

  socket.on('music:play', async (req, ack) => {
    if (!isFunction(ack)) return;
    const bot = getBot();
    if (!bot) return ack({ ok: false, error: NOT_ON });
    if (tooFast()) return ack({ ok: false, error: 'Devagar: muitos pedidos seguidos.' });
    const input = typeof req?.input === 'string' ? req.input.trim().slice(0, MAX_INPUT_LENGTH) : '';
    try {
      const result = await bot.playFromPanel(userId, input, req?.next === true);
      ack(result.ok ? { ok: true, data: { message: result.message } } : result);
    } catch (err) {
      console.error('[música] pedido do painel', err);
      ack({ ok: false, error: FAILED });
    }
  });

  socket.on('music:control', async (req, ack) => {
    if (!isFunction(ack)) return;
    const bot = getBot();
    if (!bot) return ack({ ok: false, error: NOT_ON });
    if (tooFast()) return ack({ ok: false, error: 'Devagar: muitos pedidos seguidos.' });
    const control = readControl(req);
    if (!control) return ack({ ok: false, error: 'Pedido inválido.' });
    try {
      const result = await bot.controlFromPanel(userId, control);
      ack(result.ok ? { ok: true, data: null } : result);
    } catch (err) {
      console.error('[música] controle do painel', err);
      ack({ ok: false, error: FAILED });
    }
  });
}

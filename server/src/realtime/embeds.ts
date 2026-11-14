// Pré-visualização de links pelo socket. O site pede o cartão do primeiro link de cada mensagem que mostra; o servidor
// só busca o que de fato está numa mensagem que a pessoa pode ler (assim o pedido não serve de "visitador" de endereços
// à escolha) e limita o ritmo de cada pessoa: abrir um canal cheio de links passa, uma enxurrada não.

import { firstLink } from '../../../shared/src/links.js';
import type { EmbedService } from '../embeds/service.js';
import type { RateLimits } from '../rate-limit.js';
import type { Store } from '../store.js';
import { isFunction, messageTarget } from './guards.js';
import type { AppSocket } from './types.js';

export function registerEmbeds(socket: AppSocket, store: Store, embeds: EmbedService, limits: RateLimits): void {
  const { userId } = socket.data;

  socket.on('link:preview', async (req, ack) => {
    if (!isFunction(ack)) return;
    if (!limits.linkPreview.take(userId)) return ack({ ok: false, error: 'Devagar: muitos pedidos seguidos.' });
    if (typeof req?.messageId !== 'string' || typeof req.url !== 'string') return ack({ ok: true, data: null });
    try {
      const message = await store.findMessage(req.messageId);
      const readable = message && messageTarget(store, userId, message.channelId, 'read');
      // Só o primeiro link da mensagem, exatamente como está escrito nela.
      if (!message || !readable || firstLink(message.content) !== req.url) return ack({ ok: true, data: null });
      ack({ ok: true, data: await embeds.preview(req.url) });
    } catch (err) {
      console.error('[link:preview]', err);
      ack({ ok: true, data: null });
    }
  });
}

// O resumo da mensagem respondida, mostrado acima da resposta. Servidor e site usam o mesmo corte, para o
// resumo que chega com a mensagem e o que o site atualiza ao editar a original serem iguais.

import type { Message, ReplyPreview } from './models.js';

const REPLY_EXCERPT_LENGTH = 100;

/** Começo do texto, numa linha só e sem espaços sobrando. */
export function replyExcerpt(content: string): string {
  const oneLine = content.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= REPLY_EXCERPT_LENGTH) return oneLine;
  // O corte não pode deixar uma menção `<@id>` pela metade: o pedaço apareceria como texto solto.
  // Também não pode deixar metade de um emoji (par substituto): ele apareceria como "�".
  const cut = oneLine
    .slice(0, REPLY_EXCERPT_LENGTH - 1)
    .replace(/[\uD800-\uDBFF]$/, '')
    .replace(/<@[^>]*$/, '');
  return `${cut.trimEnd()}…`;
}

/** A mensagem original sumiu. */
export const deletedReply = (id: string): ReplyPreview => ({ id, deleted: true, authorId: null, excerpt: '', hasAttachments: false });

export const replyPreviewOf = (message: Pick<Message, 'id' | 'authorId' | 'content'> & { attachments: unknown[] }): ReplyPreview => ({
  id: message.id,
  deleted: false,
  authorId: message.authorId,
  excerpt: replyExcerpt(message.content),
  hasAttachments: message.attachments.length > 0,
});

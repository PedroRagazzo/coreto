// Quando e como avisar de uma mensagem nova com uma notificação do sistema (o "toast" do Windows). Decidido aqui,
// sem tocar em nada, para dar para testar.

import { decodeMentions, mentionedUserIds } from './markup.js';
import type { Id, Message } from './models.js';

export const NOTIFICATION_BODY_LENGTH = 140;

export interface ToastInput {
  /** Você. */
  me: Id;
  message: Message;
  /** Nome de exibição de uma pessoa; `null` se não se sabe. */
  nameOf(userId: Id): string | null;
  /** Nome do canal, sem o "#"; `null` numa conversa direta. */
  channelName: string | null;
  /** Quem escreveu é um robô: robôs nunca geram notificação. */
  authorIsBot: boolean;
  /** Mostrar o texto da mensagem (senão, só que chegou algo). */
  preview: boolean;
}

export interface Toast {
  title: string;
  body: string;
  /** Notificações de uma mesma conversa se substituem em vez de empilhar. */
  tag: string;
}

/**
 * A notificação de uma mensagem, ou `null` se ela não merece uma. Merecem: toda mensagem direta de outra pessoa
 * e, em canais, só as que mencionam você ou respondem a uma mensagem sua. O resto fica com o contador de não lidas.
 */
export function toastFor(input: ToastInput): Toast | null {
  const { me, message, channelName, preview } = input;
  if (message.authorId === me || input.authorIsBot) return null;
  const direct = channelName === null;
  const mentionsMe = mentionedUserIds(message.content).includes(me);
  const repliesToMe = message.replyTo?.authorId === me;
  if (!direct && !mentionsMe && !repliesToMe) return null;

  const author = input.nameOf(message.authorId) ?? 'Alguém';
  return {
    title: direct ? author : `${author} em #${channelName}`,
    body: preview ? previewOf(message, input.nameOf) : hint(direct, repliesToMe),
    tag: message.channelId,
  };
}

/** O que dizer quando o texto da mensagem não pode aparecer na notificação. */
const hint = (direct: boolean, repliesToMe: boolean): string =>
  direct ? 'Enviou uma mensagem' : repliesToMe ? 'Respondeu a você' : 'Mencionou você';

function previewOf(message: Message, nameOf: (userId: Id) => string | null): string {
  const text = decodeMentions(message.content, nameOf).replace(/\s+/g, ' ').trim();
  if (!text) {
    const images = message.attachments.length;
    return images === 1 ? 'Enviou uma imagem' : `Enviou ${images} imagens`;
  }
  return text.length > NOTIFICATION_BODY_LENGTH ? `${text.slice(0, NOTIFICATION_BODY_LENGTH - 1).trimEnd()}…` : text;
}

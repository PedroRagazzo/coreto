import type { Channel, ChannelKind, DirectConversation, Id } from '../../../shared/src/models.js';
import { hasPermission, Permission } from '../../../shared/src/permissions.js';
import type { Store } from '../store.js';

/** Payloads vêm do cliente: confira tipo, existência e permissão antes de agir. */
export function channelWithPermission(
  store: Store,
  userId: Id,
  channelId: unknown,
  kind: ChannelKind,
  flag: number,
): Channel | null {
  if (typeof channelId !== 'string') return null;
  const channel = store.channels.get(channelId);
  if (!channel || channel.kind !== kind) return null;
  return hasPermission(store.permissionsFor(userId, channel), flag) ? channel : null;
}

export type MessageTarget =
  | { kind: 'channel'; id: Id; channel: Channel }
  | { kind: 'direct'; id: Id; conversation: DirectConversation };

/**
 * Onde o usuário pode ler (`read`) ou escrever (`write`) mensagens: um canal de
 * texto com a permissão certa ou uma conversa direta da qual ele participa.
 */
export function messageTarget(store: Store, userId: Id, id: unknown, access: 'read' | 'write'): MessageTarget | null {
  const flag = access === 'read' ? Permission.VIEW_CHANNEL : Permission.SEND_MESSAGES;
  const channel = channelWithPermission(store, userId, id, 'text', flag);
  if (channel) return { kind: 'channel', id: channel.id, channel };
  if (typeof id !== 'string') return null;
  const conversation = store.directFor(userId, id);
  return conversation ? { kind: 'direct', id: conversation.id, conversation } : null;
}

export const isFunction = (value: unknown): value is (...args: never[]) => void => typeof value === 'function';

/** Registra a falha no log do servidor e devolve uma mensagem genérica para o cliente. */
export function storageError(context: string, err: unknown): { ok: false; error: string } {
  console.error(`[${context}]`, err);
  return { ok: false, error: 'Erro ao acessar o banco de dados. Tente de novo.' };
}

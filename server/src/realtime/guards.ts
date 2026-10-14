import type { Channel, ChannelKind, Id } from '../../../shared/src/models.js';
import { hasPermission } from '../../../shared/src/permissions.js';
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

export const isFunction = (value: unknown): value is (...args: never[]) => void => typeof value === 'function';

import type { Id } from '@shared/models';
import { useEffect, useState } from 'react';
import { useRealtime } from '../state/realtime';
import { displayNameOf } from '../state/selectors';

/** Re-renderiza periodicamente para que avisos expirados sumam sozinhos. */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function TypingIndicator({ channelId }: { channelId: Id }) {
  const { state } = useRealtime();
  const now = useNow(1_000);
  const typists = Object.entries(state.typing[channelId] ?? {})
    .filter(([userId, until]) => until > now && userId !== state.me?.id)
    .map(([userId]) => displayNameOf(state.snapshot, state.users, userId));

  let text = '';
  if (typists.length === 1) text = `${typists[0]} está digitando…`;
  else if (typists.length === 2) text = `${typists[0]} e ${typists[1]} estão digitando…`;
  else if (typists.length > 2) text = 'Várias pessoas estão digitando…';

  // Altura fixa: o campo de mensagem não pula quando o aviso aparece.
  return (
    <div aria-live="polite" className="h-6 truncate px-4 text-xs leading-6 text-muted">
      {text && <span className="font-medium">{text}</span>}
    </div>
  );
}

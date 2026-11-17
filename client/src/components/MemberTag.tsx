import type { User } from '@shared/models';
import { useRealtime } from '../state/realtime';
import { tagOf } from '../state/selectors';

interface MemberTagProps {
  user: User | undefined;
  className?: string;
}

/** A etiqueta ao lado do nome de alguém (a do "ROBÔ" ou uma que um administrador do espaço deu). Não aparece sem etiqueta. */
export function MemberTag({ user, className = '' }: MemberTagProps) {
  const { state } = useRealtime();
  const tag = tagOf(state.snapshot, user);
  if (!tag) return null;
  return (
    <span
      className={`rounded px-1 text-[10px] font-semibold text-white ${tag.color ? '' : 'bg-accent'} ${className}`}
      style={tag.color ? { backgroundColor: tag.color } : undefined}
    >
      {tag.text}
    </span>
  );
}

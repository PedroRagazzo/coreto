import { MessageCircle, Plus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { initials } from '../lib/format';
import { useRealtime } from '../state/realtime';
import { CreateSpaceDialog } from './CreateSpaceDialog';

export function SpaceRail() {
  const { state, actions } = useRealtime();
  const [creating, setCreating] = useState(false);
  const unreadDirects = Object.values(state.unread).reduce((sum, n) => sum + n, 0);

  return (
    <nav aria-label="Espaços" className="flex w-[72px] shrink-0 flex-col items-center gap-2 overflow-y-auto bg-rail py-3">
      <RailButton
        label={unreadDirects ? `Mensagens diretas (${unreadDirects} não lidas)` : 'Mensagens diretas'}
        active={state.activeSpaceId === null}
        onClick={() => actions.selectSpace(null)}
        badge={unreadDirects}
      >
        <MessageCircle size={22} />
      </RailButton>

      <div aria-hidden className="my-1 h-0.5 w-8 rounded-full bg-line" />

      {state.spaces.map((space) => (
        <RailButton
          key={space.id}
          label={space.name}
          active={state.activeSpaceId === space.id}
          onClick={() => actions.selectSpace(space.id)}
        >
          {space.iconUrl ? (
            <img src={space.iconUrl} alt="" className="h-full w-full rounded-full object-cover" />
          ) : (
            <span className="text-sm font-semibold">{initials(space.name)}</span>
          )}
        </RailButton>
      ))}

      <RailButton label="Criar um espaço" active={false} onClick={() => setCreating(true)}>
        <Plus size={22} className="text-accent group-hover:text-white" />
      </RailButton>
      {creating && <CreateSpaceDialog onClose={() => setCreating(false)} />}
    </nav>
  );
}

interface RailButtonProps {
  label: string;
  active: boolean;
  onClick: () => void;
  /** Contador no canto inferior direito; 0 esconde. */
  badge?: number;
  children: ReactNode;
}

function RailButton({ label, active, onClick, badge = 0, children }: RailButtonProps) {
  return (
    <div className="group relative flex w-full justify-center">
      {/* Indicador à esquerda: cresce no hover e fica alto no item ativo. */}
      <span
        aria-hidden
        className={`absolute top-1/2 left-0 w-1 -translate-y-1/2 rounded-r-full bg-fg transition-all ${
          active ? 'h-9' : 'h-0 group-hover:h-4'
        }`}
      />
      <button
        type="button"
        title={label}
        aria-label={label}
        aria-current={active ? 'page' : undefined}
        onClick={onClick}
        className={`flex h-12 w-12 items-center justify-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-accent ${
          active ? 'bg-accent text-white' : 'bg-elevated text-muted hover:bg-accent-strong hover:text-white'
        }`}
      >
        {children}
      </button>
      {badge > 0 && (
        <span
          aria-hidden
          className="pointer-events-none absolute right-2.5 -bottom-0.5 min-w-5 rounded-full border-[3px] border-rail bg-dnd px-1 text-center text-[11px] leading-[14px] font-bold text-white"
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </div>
  );
}

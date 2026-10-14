import { MessageCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { initials } from '../lib/format';
import { useRealtime } from '../state/realtime';

export function SpaceRail() {
  const { state, actions } = useRealtime();

  return (
    <nav aria-label="Espaços" className="flex w-[72px] shrink-0 flex-col items-center gap-2 overflow-y-auto bg-rail py-3">
      <RailButton
        label="Mensagens diretas"
        active={state.activeSpaceId === null}
        onClick={() => actions.selectSpace(null)}
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
    </nav>
  );
}

interface RailButtonProps {
  label: string;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}

function RailButton({ label, active, onClick, children }: RailButtonProps) {
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
    </div>
  );
}

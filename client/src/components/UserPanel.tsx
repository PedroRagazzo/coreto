import type { SelectableStatus } from '@shared/protocol';
import { useEffect, useRef, useState } from 'react';
import { useRealtime } from '../state/realtime';
import { Avatar, STATUS_DOT, STATUS_LABEL } from './Avatar';

const SELECTABLE: SelectableStatus[] = ['online', 'idle', 'dnd'];

export function UserPanel() {
  const { state, actions } = useRealtime();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const me = state.me;
  if (!me) return null;

  return (
    <div ref={containerRef} className="relative flex h-14 shrink-0 items-center bg-rail/70 px-2">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md p-1 text-left hover:bg-hover"
      >
        <Avatar name={me.displayName} color={me.avatarColor} status={me.status} size="sm" ringClass="border-rail" />
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{me.displayName}</span>
          <span className="block truncate text-xs text-muted">{STATUS_LABEL[me.status]}</span>
        </span>
      </button>

      {open && (
        <ul
          role="menu"
          aria-label="Definir status"
          className="absolute bottom-full left-2 mb-2 w-56 rounded-lg border border-line bg-elevated p-1 shadow-xl"
        >
          {SELECTABLE.map((status) => (
            <li key={status} role="none">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={me.status === status}
                onClick={() => {
                  actions.setPresence(status);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-hover"
              >
                <span className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT[status]}`} />
                {STATUS_LABEL[status]}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

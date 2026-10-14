import type { MentionCandidate } from '@shared/markup';
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { useRealtime } from '../state/realtime';
import { Avatar } from './Avatar';

const MAX_SUGGESTIONS = 8;
/** "@" no começo ou depois de algo que não é letra, seguido do que já foi digitado até o cursor. */
const QUERY = /(^|[^\p{L}\p{N}_])@([^@\n]{0,32})$/u;

interface Query {
  /** Posição do "@". */
  start: number;
  text: string;
}

function readQuery(el: HTMLTextAreaElement): Query | null {
  if (el.selectionStart !== el.selectionEnd) return null;
  const before = el.value.slice(0, el.selectionStart);
  const match = QUERY.exec(before);
  return match ? { start: before.length - match[2].length - 1, text: match[2] } : null;
}

function suggestionsFor(candidates: MentionCandidate[], text: string): MentionCandidate[] {
  const query = text.toLocaleLowerCase();
  const matches = (c: MentionCandidate) => {
    const name = c.name.toLocaleLowerCase();
    return name.startsWith(query) || name.split(/\s+/).some((word) => word.startsWith(query));
  };
  return candidates
    .filter(matches)
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    .slice(0, MAX_SUGGESTIONS);
}

/**
 * Sugestões de menção para um textarea: digite "@" e parte do nome, escolha com
 * as setas e Enter/Tab (ou o mouse). O texto recebe "@Nome "; quem envia
 * converte para `<@id>` com `encodeMentions`.
 */
export function useMentionAutocomplete(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  setValue: (value: string) => void,
  candidates: MentionCandidate[],
) {
  const { state } = useRealtime();
  const listId = useId();
  const [query, setQuery] = useState<Query | null>(null);
  const [highlighted, setHighlighted] = useState(0);
  /** "@" cuja sugestão já foi escolhida ou dispensada com Esc. */
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const caretAfterInsert = useRef<number | null>(null);

  const suggestions = query && query.start !== dismissedAt ? suggestionsFor(candidates, query.text) : [];
  const open = suggestions.length > 0;
  const active = Math.min(highlighted, suggestions.length - 1);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && caretAfterInsert.current !== null) {
      el.setSelectionRange(caretAfterInsert.current, caretAfterInsert.current);
      caretAfterInsert.current = null;
    }
  }, [value, ref]);

  const refresh = () => {
    const el = ref.current;
    const next = el ? readQuery(el) : null;
    if (next?.start !== query?.start) setHighlighted(0);
    if (next?.start !== dismissedAt) setDismissedAt(null);
    setQuery(next);
  };

  const choose = (candidate: MentionCandidate) => {
    const el = ref.current;
    if (!el || !query) return;
    const insert = `@${candidate.name} `;
    const end = el.selectionStart;
    caretAfterInsert.current = query.start + insert.length;
    setDismissedAt(query.start);
    setValue(value.slice(0, query.start) + insert + value.slice(end));
  };

  /** Trata as teclas da lista aberta; `true` = a tecla foi usada aqui. */
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open || e.nativeEvent.isComposing) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setHighlighted((active + step + suggestions.length) % suggestions.length);
      return true;
    }
    if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
      e.preventDefault();
      choose(suggestions[active]);
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setDismissedAt(query!.start);
      return true;
    }
    return false;
  };

  const optionId = (i: number) => `${listId}-${i}`;
  const popup: ReactNode = open && (
    <ul
      id={listId}
      role="listbox"
      aria-label="Mencionar"
      className="absolute right-0 bottom-full left-0 z-20 mb-2 overflow-hidden rounded-lg border border-line bg-elevated py-1 shadow-xl"
    >
      <li aria-hidden className="px-3 pt-1 pb-1.5 text-[11px] font-semibold tracking-wide text-faint uppercase">
        Mencionar
      </li>
      {suggestions.map((candidate, i) => {
        const user = state.users[candidate.id];
        return (
          <li
            key={candidate.id}
            id={optionId(i)}
            role="option"
            aria-selected={i === active}
            // mousedown, não click: o textarea não pode perder o foco.
            onMouseDown={(e) => {
              e.preventDefault();
              choose(candidate);
            }}
            onMouseEnter={() => setHighlighted(i)}
            className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm ${i === active ? 'bg-hover text-fg' : 'text-muted'}`}
          >
            <Avatar name={candidate.name} color={user?.avatarColor ?? '#555'} size="xs" />
            <span className="truncate">{candidate.name}</span>
          </li>
        );
      })}
    </ul>
  );

  return {
    popup,
    handleKeyDown,
    inputProps: {
      'aria-autocomplete': 'list' as const,
      'aria-controls': open ? listId : undefined,
      'aria-activedescendant': open ? optionId(active) : undefined,
      onChange: refresh,
      onSelect: refresh,
      onBlur: () => setQuery(null),
    },
  };
}

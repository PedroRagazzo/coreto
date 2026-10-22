import { REACTION_EMOJIS } from '@shared/emoji';
import type { Message } from '@shared/models';
import { SmilePlus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useRealtime } from '../state/realtime';
import { displayNameOf } from '../state/selectors';

/** Quanto tempo o aviso de uma reação recusada fica na tela. */
const ERROR_MS = 4_000;

/** As reações de uma mensagem: um botão por emoji, com quantos reagiram, e o "+" para reagir com outro. */
export function ReactionChips({ message, onPick }: { message: Message; onPick: () => void }) {
  const { state, actions } = useRealtime();
  const [error, setError] = useState<string | null>(null);
  const me = state.me?.id;

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), ERROR_MS);
    return () => clearTimeout(timer);
  }, [error]);

  if (message.reactions.length === 0) return null;

  const toggle = async (emoji: string) => setError(await actions.toggleReaction(message.id, emoji));

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1" role="group" aria-label="Reações">
      {message.reactions.map((reaction) => {
        const mine = me !== undefined && reaction.userIds.includes(me);
        const names = reaction.userIds.map((id) => displayNameOf(state.snapshot, state.users, id)).join(', ');
        return (
          <button
            key={reaction.emoji}
            type="button"
            aria-pressed={mine}
            aria-label={`${reaction.emoji} ${reaction.userIds.length}: ${names}`}
            title={`${names} reagiu com ${reaction.emoji}`}
            onClick={() => void toggle(reaction.emoji)}
            className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-sm leading-5 ${
              mine ? 'border-accent bg-accent/15 text-fg' : 'border-line bg-rail/60 text-muted hover:border-faint hover:text-fg'
            }`}
          >
            <span aria-hidden>{reaction.emoji}</span>
            <span className="text-xs font-medium tabular-nums">{reaction.userIds.length}</span>
          </button>
        );
      })}
      <button
        type="button"
        onClick={onPick}
        aria-label="Adicionar reação"
        title="Adicionar reação"
        className="rounded-full border border-transparent p-1 text-faint hover:bg-hover hover:text-fg"
      >
        <SmilePlus size={15} />
      </button>
      {error && (
        <span role="alert" className="text-xs text-dnd">
          {error}
        </span>
      )}
    </div>
  );
}

/** Escolhe um emoji para reagir; fecha com Esc ou ao clicar fora. */
export function ReactionPicker({ message, onClose }: { message: Message; onClose: () => void }) {
  const { state, actions } = useRealtime();
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const me = state.me?.id;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  async function pick(emoji: string) {
    const err = await actions.toggleReaction(message.id, emoji);
    if (err) setError(err);
    else onClose();
  }

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Escolher reação"
      className="absolute top-5 right-4 z-20 w-64 rounded-lg border border-line bg-elevated p-2 shadow-xl"
    >
      <div className="grid grid-cols-8 gap-0.5">
        {REACTION_EMOJIS.map((emoji) => {
          const mine = me !== undefined && message.reactions.some((r) => r.emoji === emoji && r.userIds.includes(me));
          return (
            <button
              key={emoji}
              type="button"
              onClick={() => void pick(emoji)}
              aria-label={mine ? `Tirar a reação ${emoji}` : `Reagir com ${emoji}`}
              aria-pressed={mine}
              className={`rounded p-1 text-xl leading-6 hover:bg-hover ${mine ? 'bg-accent/20' : ''}`}
            >
              {emoji}
            </button>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="mt-1 px-1 text-xs text-dnd">
          {error}
        </p>
      )}
    </div>
  );
}

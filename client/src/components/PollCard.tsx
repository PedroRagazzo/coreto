import type { Message } from '@shared/models';
import { Permission } from '@shared/permissions';
import { Check } from 'lucide-react';
import { useState } from 'react';
import { useRealtime } from '../state/realtime';
import { can, displayNameOf } from '../state/selectors';

/** A enquete de uma mensagem: cada opção é um botão com a barra de votos; um clique vota (e outro tira o voto). */
export function PollCard({ message }: { message: Message }) {
  const { state, actions } = useRealtime();
  const poll = message.poll!;
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);

  const me = state.me?.id;
  const people = new Set(poll.options.flatMap((o) => o.userIds)).size;
  const canClose = !poll.closed && (message.authorId === me || can(state.snapshot, message.channelId, Permission.MANAGE_MESSAGES));
  const nameOf = (id: string) => displayNameOf(state.snapshot, state.users, id);

  async function vote(optionId: string) {
    setError(null);
    setError(await actions.votePoll(message.id, optionId));
  }

  async function close() {
    setClosing(true);
    setError(await actions.closePoll(message.id));
    setClosing(false);
  }

  return (
    <div className="mt-2 w-full max-w-md rounded-lg border border-line bg-rail/60 p-3">
      <ul className="space-y-1.5">
        {poll.options.map((option) => {
          const mine = me !== undefined && option.userIds.includes(me);
          const percent = people > 0 ? Math.round((option.userIds.length / people) * 100) : 0;
          const who = option.userIds.map(nameOf).join(', ');
          return (
            <li key={option.id}>
              <button
                type="button"
                disabled={poll.closed}
                onClick={() => void vote(option.id)}
                aria-pressed={mine}
                title={who ? `Votaram: ${who}` : 'Ninguém votou ainda'}
                className={`relative flex w-full items-center gap-2 overflow-hidden rounded-md border px-3 py-2 text-left text-sm ${
                  mine ? 'border-accent' : 'border-line'
                } ${poll.closed ? 'cursor-default' : 'hover:border-accent/70'}`}
              >
                <span
                  aria-hidden
                  className={`absolute inset-y-0 left-0 transition-[width] duration-300 ${mine ? 'bg-accent/30' : 'bg-hover'}`}
                  style={{ width: `${percent}%` }}
                />
                <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
                  {mine ? (
                    <Check size={14} className="text-accent" aria-hidden />
                  ) : (
                    <span aria-hidden className={`h-3.5 w-3.5 border border-faint ${poll.multiple ? 'rounded-[3px]' : 'rounded-full'}`} />
                  )}
                </span>
                <span className="relative min-w-0 flex-1 break-words">{option.text}</span>
                <span className="relative shrink-0 text-xs text-muted tabular-nums">
                  {option.userIds.length} · {percent}%
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <p className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-faint">
        <span>
          {people === 0 ? 'Ninguém votou ainda' : people === 1 ? '1 pessoa votou' : `${people} pessoas votaram`}
        </span>
        <span aria-hidden>·</span>
        <span>{poll.closed ? 'Encerrada' : poll.multiple ? 'Pode marcar várias' : 'Uma resposta'}</span>
        {canClose && (
          <>
            <span aria-hidden>·</span>
            <button type="button" disabled={closing} onClick={() => void close()} className="text-muted hover:text-fg hover:underline disabled:opacity-50">
              Encerrar enquete
            </button>
          </>
        )}
      </p>
      {error && (
        <p role="alert" className="mt-1 text-xs text-dnd">
          {error}
        </p>
      )}
    </div>
  );
}

import type { Id, Message } from '@shared/models';
import { Paperclip, Pin, PinOff, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatMessageTime } from '../lib/format';
import { useRealtime } from '../state/realtime';
import { displayNameOf } from '../state/selectors';
import { Avatar } from './Avatar';
import { Markup } from './MessageContent';

interface PinsPanelProps {
  /** Canal de texto ou conversa direta. */
  channelId: Id;
  /** Pode desafixar (quem pode escrever ali). */
  canPin: boolean;
  onClose: () => void;
}

/** As mensagens fixadas do canal, ao lado da conversa. Clicar numa leva até ela no histórico. */
export function PinsPanel({ channelId, canPin, onClose }: PinsPanelProps) {
  const { state, actions } = useRealtime();
  const [pins, setPins] = useState<Message[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Sobe quando alguém fixa, desafixa, edita ou apaga uma mensagem fixada: recarrega a lista.
  const version = state.pinsVersion[channelId] ?? 0;

  useEffect(() => {
    let current = true;
    void actions.loadPins(channelId).then((res) => {
      if (!current) return;
      if ('error' in res) setError(res.error);
      else {
        setError(null);
        setPins(res.messages);
      }
    });
    return () => {
      current = false;
    };
  }, [actions, channelId, version]);

  return (
    <aside aria-label="Mensagens fixadas" className="hidden w-[340px] shrink-0 flex-col border-l border-line bg-sidebar lg:flex">
      <div className="flex items-center gap-2 border-b border-line p-3">
        <Pin size={16} className="shrink-0 text-muted" aria-hidden />
        <h3 className="flex-1 text-sm font-semibold">Mensagens fixadas</h3>
        <button type="button" onClick={onClose} aria-label="Fechar mensagens fixadas" className="rounded p-1 text-muted hover:bg-hover hover:text-fg">
          <X size={18} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3" aria-live="polite">
        {error && <p className="text-sm text-dnd">{error}</p>}
        {!error && pins === null && <p className="text-sm text-muted">Carregando…</p>}
        {pins?.length === 0 && (
          <p className="text-sm text-muted">
            Nada fixado ainda. Passe o mouse numa mensagem e clique no alfinete para fixá-la aqui.
          </p>
        )}
        {pins && pins.length > 0 && (
          <ul className="space-y-2">
            {pins.map((message) => (
              <PinItem key={message.id} message={message} canPin={canPin} />
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

function PinItem({ message, canPin }: { message: Message; canPin: boolean }) {
  const { state, actions } = useRealtime();
  const [error, setError] = useState<string | null>(null);
  const name = displayNameOf(state.snapshot, state.users, message.authorId);
  const user = state.users[message.authorId];
  const pinner = message.pinnedById ? displayNameOf(state.snapshot, state.users, message.pinnedById) : null;

  return (
    <li className="rounded-md bg-panel">
      <button
        type="button"
        onClick={() => void actions.jumpToMessage(message).then(setError)}
        title="Ir para a mensagem"
        className="w-full rounded-md p-2.5 text-left hover:bg-hover/60 focus-visible:outline-2 focus-visible:outline-accent"
      >
        <div className="flex gap-2">
          <Avatar name={name} color={user?.avatarColor ?? '#555'} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="flex items-baseline gap-2">
              <span className="truncate text-sm font-medium">{name}</span>
              <time dateTime={message.createdAt} className="shrink-0 text-[11px] text-faint">
                {formatMessageTime(message.createdAt)}
              </time>
            </p>
            <div className="line-clamp-5 text-sm break-words whitespace-pre-wrap text-fg/90">
              <Markup content={message.content} />
              {message.attachments.length > 0 && (
                <span className="ml-1 inline-flex items-center gap-0.5 text-xs text-faint">
                  <Paperclip size={12} /> {message.attachments.length}
                </span>
              )}
            </div>
          </div>
        </div>
      </button>
      <div className="flex items-center gap-2 border-t border-line px-2.5 py-1.5 text-xs text-faint">
        <span className="min-w-0 flex-1 truncate">{pinner ? `Fixada por ${pinner}` : 'Fixada'}</span>
        {canPin && (
          <button
            type="button"
            onClick={() => void actions.pinMessage(message.id, false).then(setError)}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-muted hover:bg-hover hover:text-fg"
          >
            <PinOff size={12} aria-hidden /> Desafixar
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="px-2.5 pb-2 text-xs text-dnd">
          {error}
        </p>
      )}
    </li>
  );
}

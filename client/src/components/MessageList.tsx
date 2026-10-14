import type { Id, Message } from '@shared/models';
import { Permission } from '@shared/permissions';
import { MAX_MESSAGE_LENGTH } from '@shared/protocol';
import { Pencil, Trash2 } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { formatMessageTime, formatShortTime } from '../lib/format';
import { useRealtime } from '../state/realtime';
import { can, displayNameOf, roleColorOf } from '../state/selectors';
import { Avatar } from './Avatar';
import { DialogActions, Modal } from './Modal';

/** Mensagens seguidas do mesmo autor dentro desta janela viram um bloco só. */
const GROUP_WINDOW_MS = 5 * 60_000;
/** A esta distância do topo, começa a buscar mensagens antigas. */
const LOAD_OLDER_THRESHOLD_PX = 300;

interface MessageGroup {
  authorId: Id;
  items: Message[];
}

function groupMessages(messages: Message[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  for (const message of messages) {
    const last = groups.at(-1);
    const previous = last?.items.at(-1);
    if (
      last &&
      previous &&
      last.authorId === message.authorId &&
      Date.parse(message.createdAt) - Date.parse(previous.createdAt) < GROUP_WINDOW_MS
    ) {
      last.items.push(message);
    } else {
      groups.push({ authorId: message.authorId, items: [message] });
    }
  }
  return groups;
}

interface MessageListProps {
  /** Canal de texto ou conversa direta. */
  conversationId: Id;
  /** Bloco de boas-vindas, mostrado quando o histórico chega ao começo. */
  welcome: ReactNode;
  messages: Message[];
}

export function MessageList({ conversationId, welcome, messages }: MessageListProps) {
  const { state, actions } = useRealtime();
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  /** Posição antes de buscar mensagens antigas, para a leitura não pular quando elas entram em cima. */
  const anchor = useRef<{ firstId: Id; scrollHeight: number; scrollTop: number } | null>(null);
  const [editingId, setEditingId] = useState<Id | null>(null);
  const [deleting, setDeleting] = useState<Message | null>(null);

  const complete = Boolean(state.historyComplete[conversationId]);
  const loadingOlder = Boolean(state.loadingOlder[conversationId]);
  const moderates = can(state.snapshot, conversationId, Permission.MANAGE_MESSAGES);

  const loadOlder = () => {
    const el = scrollRef.current;
    if (!el || complete || loadingOlder || messages.length === 0) return;
    anchor.current = { firstId: messages[0].id, scrollHeight: el.scrollHeight, scrollTop: el.scrollTop };
    actions.loadOlder(conversationId);
  };

  // Trocar de conversa sempre leva ao fim; mensagens novas só rolam se você já estava no fim.
  useLayoutEffect(() => {
    stickToBottom.current = true;
    anchor.current = null;
    setEditingId(null);
  }, [conversationId]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const saved = anchor.current;
    if (saved && messages[0]?.id !== saved.firstId) {
      // Mensagens antigas entraram em cima: compensa a altura nova.
      el.scrollTop = el.scrollHeight - saved.scrollHeight + saved.scrollTop;
      anchor.current = null;
    } else if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
    // Se o histórico ainda não preenche a tela, não há como rolar: busca a próxima página já.
    if (!complete && !loadingOlder && el.scrollHeight <= el.clientHeight) loadOlder();
  }, [messages, conversationId, complete, loadingOlder]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < LOAD_OLDER_THRESHOLD_PX) loadOlder();
  };

  return (
    <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto" role="log" aria-live="polite">
      <div className="flex min-h-full flex-col justify-end pb-4">
        {complete ? (
          <div className="px-4 pt-8 pb-4">{welcome}</div>
        ) : (
          <p aria-live="polite" className="px-4 py-4 text-center text-sm text-faint">
            {loadingOlder ? 'Carregando mensagens antigas…' : ''}
          </p>
        )}

        {groupMessages(messages).map((group) => {
          const author = state.users[group.authorId];
          const name = displayNameOf(state.snapshot, state.users, group.authorId);
          const mine = group.authorId === state.me?.id;
          const [first] = group.items;
          return (
            <article key={first.id} className="mt-4">
              {group.items.map((message, index) => (
                <MessageRow
                  key={message.id}
                  message={message}
                  editing={editingId === message.id}
                  onEdit={mine ? () => setEditingId(message.id) : undefined}
                  onDelete={mine || moderates ? () => setDeleting(message) : undefined}
                  onEditDone={() => setEditingId(null)}
                  leading={
                    index === 0 ? (
                      <Avatar name={name} color={author?.avatarColor ?? '#555'} />
                    ) : (
                      <time
                        dateTime={message.createdAt}
                        className="w-10 shrink-0 pt-1 text-right text-[10px] text-faint opacity-0 group-hover:opacity-100"
                      >
                        {formatShortTime(message.createdAt)}
                      </time>
                    )
                  }
                  header={
                    index === 0 && (
                      <p className="flex items-baseline gap-2">
                        <span
                          className="font-medium"
                          style={{ color: roleColorOf(state.snapshot, group.authorId) ?? undefined }}
                        >
                          {name}
                        </span>
                        {author?.isBot && (
                          <span className="rounded bg-accent px-1 text-[10px] font-semibold text-white">ROBÔ</span>
                        )}
                        <time dateTime={message.createdAt} className="text-xs text-faint">
                          {formatMessageTime(message.createdAt)}
                        </time>
                      </p>
                    )
                  }
                />
              ))}
            </article>
          );
        })}
      </div>

      {deleting && <DeleteMessageDialog message={deleting} onClose={() => setDeleting(null)} />}
    </div>
  );
}

interface MessageRowProps {
  message: Message;
  leading: ReactNode;
  header: ReactNode;
  editing: boolean;
  /** Ausente quando a mensagem não é sua. */
  onEdit?: () => void;
  /** Ausente quando você não pode apagar. */
  onDelete?: () => void;
  onEditDone: () => void;
}

function MessageRow({ message, leading, header, editing, onEdit, onDelete, onEditDone }: MessageRowProps) {
  return (
    <div className={`group relative flex gap-4 px-4 py-0.5 ${editing ? 'bg-rail/40' : 'hover:bg-rail/30'}`}>
      {leading}
      <div className="min-w-0 flex-1">
        {header}
        {editing ? <MessageEditor message={message} onDone={onEditDone} /> : <MessageBody message={message} />}
      </div>

      {!editing && (onEdit || onDelete) && (
        <div className="absolute -top-3 right-4 flex gap-0.5 rounded-md border border-line bg-elevated p-0.5 opacity-0 shadow-lg group-hover:opacity-100 focus-within:opacity-100">
          {onEdit && (
            <button
              type="button"
              title="Editar mensagem"
              aria-label="Editar mensagem"
              onClick={onEdit}
              className="rounded p-1 text-muted hover:bg-hover hover:text-fg"
            >
              <Pencil size={15} />
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              title="Apagar mensagem"
              aria-label="Apagar mensagem"
              onClick={onDelete}
              className="rounded p-1 text-muted hover:bg-hover hover:text-dnd"
            >
              <Trash2 size={15} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function MessageBody({ message }: { message: Message }) {
  return (
    <p className="text-[15px] leading-relaxed break-words whitespace-pre-wrap text-fg/95">
      {message.content}
      {message.editedAt && (
        <span className="ml-1 text-[10px] text-faint" title={`Editada em ${formatMessageTime(message.editedAt)}`}>
          (editada)
        </span>
      )}
    </p>
  );
}

function MessageEditor({ message, onDone }: { message: Message; onDone: () => void }) {
  const { actions } = useRealtime();
  const [draft, setDraft] = useState(message.content);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  // Foco no fim do texto, com o editor e a dica de atalhos visíveis (a última mensagem fica rente ao fim).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
    el.closest('form')?.scrollIntoView({ block: 'nearest' });
  }, []);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [draft]);

  async function save(e?: FormEvent) {
    e?.preventDefault();
    const content = draft.trim();
    if (busy) return;
    if (!content) return setError('A mensagem não pode ficar vazia. Para tirá-la, use a lixeira.');
    if (content === message.content) return onDone();
    setBusy(true);
    const err = await actions.editMessage(message.id, content);
    setBusy(false);
    if (err) setError(err);
    else onDone();
  }

  return (
    <form onSubmit={save} className="py-1">
      <textarea
        ref={ref}
        rows={1}
        value={draft}
        maxLength={MAX_MESSAGE_LENGTH}
        aria-label="Editar mensagem"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onDone();
          } else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void save();
          }
        }}
        className="w-full resize-none rounded-md bg-elevated px-3 py-2 text-[15px] leading-6 outline-none focus:ring-1 focus:ring-accent/60"
      />
      <p className="mt-1 text-xs text-faint">
        Esc para{' '}
        <button type="button" onClick={onDone} className="text-accent hover:underline">
          cancelar
        </button>{' '}
        · Enter para{' '}
        <button type="submit" disabled={busy} className="text-accent hover:underline">
          salvar
        </button>
      </p>
      {error && (
        <p role="alert" className="mt-1 text-xs text-dnd">
          {error}
        </p>
      )}
    </form>
  );
}

function DeleteMessageDialog({ message, onClose }: { message: Message; onClose: () => void }) {
  const { state, actions } = useRealtime();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const author = state.users[message.authorId];
  const mine = message.authorId === state.me?.id;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const err = await actions.deleteMessage(message.id);
    setBusy(false);
    if (err) setError(err);
    else onClose();
  }

  return (
    <Modal
      title="Apagar mensagem"
      description={mine ? 'Tem certeza? Isso não pode ser desfeito.' : `Apagar a mensagem de ${author?.displayName ?? 'outra pessoa'}? Isso não pode ser desfeito.`}
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <blockquote className="max-h-40 overflow-y-auto rounded-md border border-line bg-rail px-3 py-2 text-sm whitespace-pre-wrap text-muted">
          {message.content}
        </blockquote>
        {error && (
          <p role="alert" className="mt-3 text-sm text-dnd">
            {error}
          </p>
        )}
        <DialogActions onCancel={onClose} submitLabel={busy ? 'Apagando…' : 'Apagar'} disabled={busy} danger />
      </form>
    </Modal>
  );
}

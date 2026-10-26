import { decodeMentions, encodeMentions, mentionedUserIds } from '@shared/markup';
import type { Id, Message, ReplyPreview } from '@shared/models';
import { Permission } from '@shared/permissions';
import { MAX_MESSAGE_LENGTH } from '@shared/protocol';
import { describeAttachments } from '@shared/files';
import { ArrowDown, CornerUpRight, Paperclip, Pencil, Pin, PinOff, Reply, SmilePlus, Trash2 } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { formatMessageTime, formatShortTime } from '../lib/format';
import { useRealtime } from '../state/realtime';
import { useSettings } from '../state/settings';
import { can, displayNameOf, mentionCandidates, roleColorOf } from '../state/selectors';
import { Avatar } from './Avatar';
import { Markup, MessageContent } from './MessageContent';
import { useMentionAutocomplete } from './MentionAutocomplete';
import { ReactionChips, ReactionPicker } from './MessageReactions';
import { DialogActions, Modal } from './Modal';

/** Mensagens seguidas do mesmo autor dentro desta janela viram um bloco só. */
const GROUP_WINDOW_MS = 5 * 60_000;
/** A esta distância do topo (ou do fim, numa lista parada no passado), busca a próxima página. */
const LOAD_OLDER_THRESHOLD_PX = 300;
/** Quanto tempo a mensagem encontrada pela busca fica destacada. */
const FOCUS_FLASH_MS = 2_000;

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
  const compact = useSettings().settings.appearance.compact;
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  /** Posição antes de buscar mensagens antigas, para a leitura não pular quando elas entram em cima. */
  const anchor = useRef<{ firstId: Id; scrollHeight: number; scrollTop: number } | null>(null);
  const [editingId, setEditingId] = useState<Id | null>(null);
  const [deleting, setDeleting] = useState<Message | null>(null);
  const [flashId, setFlashId] = useState<Id | null>(null);

  const complete = Boolean(state.historyComplete[conversationId]);
  /** A lista parou no passado (pulo pela busca): o fim dela não é a mensagem mais recente. */
  const detached = Boolean(state.detached[conversationId]);
  const loadingOlder = Boolean(state.loadingOlder[conversationId]);
  const moderates = can(state.snapshot, conversationId, Permission.MANAGE_MESSAGES);
  // Numa conversa direta sempre dá para escrever; num canal, depende da permissão.
  const canSend = state.activeSpaceId === null || can(state.snapshot, conversationId, Permission.SEND_MESSAGES);

  /** Vai até a mensagem respondida: rola até ela se já está na tela; senão carrega o trecho do histórico onde ela está. */
  const goToOriginal = (id: Id) => {
    const target = scrollRef.current?.querySelector<HTMLElement>(`[data-message-id="${id}"]`);
    if (target) {
      stickToBottom.current = false;
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setFlashId(id);
    } else {
      void actions.jumpToMessage({ id });
    }
  };

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
    } else if (stickToBottom.current && !detached) {
      el.scrollTop = el.scrollHeight;
    }
    // Se o histórico ainda não preenche a tela, não há como rolar: busca a próxima página já.
    if (!loadingOlder && el.scrollHeight <= el.clientHeight) {
      if (!complete) loadOlder();
      else if (detached) actions.loadNewer(conversationId);
    }
    // Um cartão de link que chega muda a altura da mensagem: se você estava no fim, continua no fim.
  }, [messages, conversationId, complete, loadingOlder, detached, state.linkPreviews]);

  // Pulo pela busca: rola até a mensagem e destaca por um instante.
  const focusId = state.focus?.channelId === conversationId ? state.focus.messageId : null;
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const target = focusId ? el?.querySelector<HTMLElement>(`[data-message-id="${focusId}"]`) : null;
    if (!target) return;
    stickToBottom.current = false;
    anchor.current = null;
    target.scrollIntoView({ block: 'center' });
    setFlashId(focusId);
    actions.focusDone();
  }, [focusId, messages, actions]);
  useEffect(() => {
    if (!flashId) return;
    const timer = setTimeout(() => setFlashId(null), FOCUS_FLASH_MS);
    return () => clearTimeout(timer);
  }, [flashId]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottom.current = fromBottom < 80;
    if (el.scrollTop < LOAD_OLDER_THRESHOLD_PX) loadOlder();
    if (detached && fromBottom < LOAD_OLDER_THRESHOLD_PX) actions.loadNewer(conversationId);
  };

  const backToPresent = () => {
    stickToBottom.current = true;
    actions.jumpToPresent(conversationId);
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
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
              <article key={first.id} className={compact ? 'mt-0.5' : 'mt-4'}>
                {group.items.map((message, index) => (
                  <MessageRow
                    key={message.id}
                    message={message}
                    flash={flashId === message.id}
                    // Responder a você também chama a atenção, como uma menção.
                    mentionsMe={Boolean(
                      state.me && (mentionedUserIds(message.content).includes(state.me.id) || message.replyTo?.authorId === state.me.id),
                    )}
                    canSend={canSend}
                    onGoToOriginal={goToOriginal}
                    editing={editingId === message.id}
                    // Enquete e roleta são a própria mensagem: para mudar, apague e crie de novo.
                    onEdit={mine && !message.poll && !message.roulette ? () => setEditingId(message.id) : undefined}
                    onDelete={mine || moderates ? () => setDeleting(message) : undefined}
                    onEditDone={() => setEditingId(null)}
                    compact={compact}
                    prefix={
                      compact && (
                        <span
                          className="mr-1.5 font-medium"
                          style={{ color: roleColorOf(state.snapshot, group.authorId) ?? undefined }}
                        >
                          {name}
                          {author?.isBot && (
                            <span className="ml-1 rounded bg-accent px-1 align-middle text-[10px] font-semibold text-white">ROBÔ</span>
                          )}
                        </span>
                      )
                    }
                    leading={
                      compact ? (
                        <time
                          dateTime={message.createdAt}
                          title={formatMessageTime(message.createdAt)}
                          className="w-11 shrink-0 pt-[0.3em] text-right text-[11px] text-faint"
                        >
                          {formatShortTime(message.createdAt)}
                        </time>
                      ) : index === 0 ? (
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
                      !compact &&
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
      {detached && (
        <div className="absolute inset-x-4 bottom-2 flex items-center gap-3 rounded-md bg-accent-strong px-3 py-1.5 text-sm text-white shadow-lg">
          <span className="flex-1">Você está vendo mensagens antigas.</span>
          <button type="button" onClick={backToPresent} className="flex items-center gap-1 font-semibold hover:underline">
            Ir para as mais recentes <ArrowDown size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

interface MessageRowProps {
  message: Message;
  /** Destaca a linha: a mensagem menciona você. */
  mentionsMe: boolean;
  /** Acabou de ser aberta pela busca: pisca o fundo. */
  flash?: boolean;
  /** Modo compacto: menos espaço entre a hora e o texto. */
  compact?: boolean;
  /** Antes do texto, na mesma linha (o nome do autor, no modo compacto). */
  prefix?: ReactNode;
  leading: ReactNode;
  header: ReactNode;
  editing: boolean;
  /** Pode escrever aqui: liga o botão de responder. */
  canSend: boolean;
  onGoToOriginal: (messageId: Id) => void;
  /** Ausente quando a mensagem não é sua. */
  onEdit?: () => void;
  /** Ausente quando você não pode apagar. */
  onDelete?: () => void;
  onEditDone: () => void;
}

function MessageRow({
  message,
  mentionsMe,
  flash = false,
  compact = false,
  prefix,
  leading,
  header,
  editing,
  canSend,
  onGoToOriginal,
  onEdit,
  onDelete,
  onEditDone,
}: MessageRowProps) {
  const { actions } = useRealtime();
  const [picking, setPicking] = useState(false);
  const background = flash
    ? 'bg-accent/20'
    : editing
      ? 'bg-rail/40'
      : mentionsMe
        ? 'border-l-2 border-mention bg-mention/[0.07] pl-[14px] hover:bg-mention/10'
        : 'hover:bg-rail/30';
  return (
    <div
      data-message-id={message.id}
      className={`group relative flex px-4 py-0.5 transition-colors duration-700 ${compact ? 'gap-2' : 'gap-4'} ${background}`}
    >
      {leading}
      <div className="min-w-0 flex-1">
        {message.replyTo && <ReplyReference reply={message.replyTo} onJump={() => onGoToOriginal(message.replyTo!.id)} />}
        {message.pinnedAt && (
          <p className="flex items-center gap-1 text-xs text-faint">
            <Pin size={11} aria-hidden /> Fixada
          </p>
        )}
        {header}
        {editing ? (
          <MessageEditor message={message} onDone={onEditDone} />
        ) : (
          <MessageContent message={message} prefix={prefix} />
        )}
        {!editing && <ReactionChips message={message} onPick={() => setPicking(true)} />}
      </div>

      {picking && <ReactionPicker message={message} onClose={() => setPicking(false)} />}

      {!editing && (
        <div className="absolute -top-3 right-4 flex gap-0.5 rounded-md border border-line bg-elevated p-0.5 opacity-0 shadow-lg group-hover:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            title="Reagir"
            aria-label="Reagir"
            onClick={() => setPicking((open) => !open)}
            className="rounded p-1 text-muted hover:bg-hover hover:text-fg"
          >
            <SmilePlus size={15} />
          </button>
          {canSend && (
            <button
              type="button"
              title={message.pinnedAt ? 'Desafixar' : 'Fixar'}
              aria-label={message.pinnedAt ? 'Desafixar mensagem' : 'Fixar mensagem'}
              onClick={() => void actions.pinMessage(message.id, !message.pinnedAt)}
              className="rounded p-1 text-muted hover:bg-hover hover:text-fg"
            >
              {message.pinnedAt ? <PinOff size={15} /> : <Pin size={15} />}
            </button>
          )}
          {canSend && (
            <button
              type="button"
              title="Responder"
              aria-label="Responder"
              onClick={() => actions.startReply(message)}
              className="rounded p-1 text-muted hover:bg-hover hover:text-fg"
            >
              <Reply size={15} />
            </button>
          )}
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

/** A linha acima de uma resposta: de quem e o começo do texto da original; clicar leva até ela. */
function ReplyReference({ reply, onJump }: { reply: ReplyPreview; onJump: () => void }) {
  const { state } = useRealtime();
  if (reply.deleted) {
    return (
      <p className="mb-0.5 flex items-center gap-1.5 text-xs text-faint italic">
        <CornerUpRight size={12} aria-hidden />
        Mensagem original apagada
      </p>
    );
  }
  const name = reply.authorId ? displayNameOf(state.snapshot, state.users, reply.authorId) : '';
  return (
    <button
      type="button"
      onClick={onJump}
      title="Ir para a mensagem respondida"
      className="mb-0.5 flex max-w-full items-center gap-1.5 text-left text-xs text-muted hover:text-fg"
    >
      <CornerUpRight size={12} className="shrink-0" aria-hidden />
      <span className="shrink-0 font-medium" style={{ color: (reply.authorId && roleColorOf(state.snapshot, reply.authorId)) || undefined }}>
        {name}
      </span>
      <span className="min-w-0 truncate">
        {reply.excerpt ? <Markup content={reply.excerpt} /> : reply.hasAttachments ? 'Anexo' : ''}
      </span>
      {reply.hasAttachments && <Paperclip size={12} className="shrink-0" aria-label="com anexo" />}
    </button>
  );
}

function MessageEditor({ message, onDone }: { message: Message; onDone: () => void }) {
  const { state, actions } = useRealtime();
  const candidates = mentionCandidates(state, message.channelId);
  // Edita com `@Nome`; volta para `<@id>` ao salvar.
  const original = decodeMentions(message.content, (id) =>
    state.users[id] ? displayNameOf(state.snapshot, state.users, id) : null,
  );
  const [draft, setDraft] = useState(original);
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
    const content = encodeMentions(draft.trim(), candidates);
    if (busy) return;
    if (!content && message.attachments.length === 0) {
      return setError('A mensagem não pode ficar vazia. Para tirá-la, use a lixeira.');
    }
    if (content === message.content) return onDone();
    setBusy(true);
    const err = await actions.editMessage(message.id, content);
    setBusy(false);
    if (err) setError(err);
    else onDone();
  }

  const autocomplete = useMentionAutocomplete(ref, draft, setDraft, candidates);

  return (
    <form onSubmit={save} className="relative py-1">
      {autocomplete.popup}
      <textarea
        ref={ref}
        rows={1}
        value={draft}
        maxLength={MAX_MESSAGE_LENGTH}
        aria-label="Editar mensagem"
        {...autocomplete.inputProps}
        onChange={(e) => {
          setDraft(e.target.value);
          autocomplete.inputProps.onChange();
        }}
        onKeyDown={(e) => {
          if (autocomplete.handleKeyDown(e)) return;
          if (e.key === 'Escape') {
            e.preventDefault();
            onDone();
          } else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void save();
          }
        }}
        className="w-full resize-none rounded-md bg-elevated px-3 py-2 text-[length:var(--message-font-size)] leading-6 outline-none focus:ring-1 focus:ring-accent/60"
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
        <blockquote className="max-h-40 overflow-y-auto rounded-md border border-line bg-rail px-3 py-2 text-sm break-words whitespace-pre-wrap text-muted">
          <Markup content={message.content} />
          {message.attachments.length > 0 && (
            <p className="mt-1 text-xs text-faint">
              {describeAttachments(message.attachments)} também
              {message.attachments.length === 1 ? ' será apagado' : ' serão apagados'}.
            </p>
          )}
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

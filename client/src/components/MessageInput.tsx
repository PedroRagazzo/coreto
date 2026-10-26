import { encodeMentions } from '@shared/markup';
import type { Attachment, Id } from '@shared/models';
import { ATTACHMENT_RETENTION_DAYS, ATTACHMENT_TYPES, MAX_ATTACHMENTS_PER_MESSAGE, MAX_MESSAGE_LENGTH } from '@shared/protocol';
import {
  ChartNoAxesColumn,
  CornerUpRight,
  LoaderCircle,
  LoaderPinwheel,
  Paperclip,
  SendHorizontal,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { formatBytes } from '@shared/files';
import { MAX_IMAGE_BYTES } from '@shared/protocol';
import { checkFile, type UploadHandle } from '../lib/uploads';
import { useRealtime } from '../state/realtime';
import { displayNameOf, mentionCandidates } from '../state/selectors';
import { CreatePollDialog } from './CreatePollDialog';
import { FileIcon } from './FileIcon';
import { CreateRouletteDialog } from './CreateRouletteDialog';
import { Markup } from './MessageContent';
import { useMentionAutocomplete } from './MentionAutocomplete';

const MAX_HEIGHT_PX = 192;
const ATTACHMENT_TYPES_SET: ReadonlySet<string> = new Set(ATTACHMENT_TYPES);

interface PendingFile {
  key: string;
  file: File;
  /** Miniatura das imagens; `null` nos outros arquivos, que aparecem com o ícone. */
  previewUrl: string | null;
  progress: number;
  /** Preenchido quando o envio termina; é o id que vai na mensagem. */
  attachment: Attachment | null;
  error: string | null;
  upload: UploadHandle | null;
}

interface MessageInputProps {
  /** Canal de texto ou conversa direta. */
  targetId: Id;
  /** Como o destino aparece no texto de ajuda: "#geral" ou "@Bruno". */
  label: string;
  canSend: boolean;
}

export function MessageInput({ targetId, label, canSend }: MessageInputProps) {
  const { state, actions } = useRealtime();
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [extrasOpen, setExtrasOpen] = useState(false);
  const [dialog, setDialog] = useState<'poll' | 'roulette' | null>(null);
  const extrasRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  // Só vale a resposta que começou neste canal ou conversa.
  const replyingTo = state.replyingTo?.channelId === targetId ? state.replyingTo : null;
  const candidates = mentionCandidates(state, targetId);
  const autocomplete = useMentionAutocomplete(textareaRef, draft, setDraft, candidates);

  // O menu de enquete e roleta fecha com um clique fora dele ou com Esc.
  useEffect(() => {
    if (!extrasOpen) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !extrasRef.current?.contains(e.target as Node)) setExtrasOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [extrasOpen]);

  // Trocar de conversa descarta o rascunho e os anexos ainda não enviados.
  useEffect(() => {
    setDraft('');
    setError(null);
    setExtrasOpen(false);
    setDialog(null);
    textareaRef.current?.focus();
    return () => {
      for (const image of pendingRef.current) discard(image);
      setPending([]);
    };
  }, [targetId]);

  // Começar a responder leva o cursor para o campo de texto.
  useEffect(() => {
    if (replyingTo) textareaRef.current?.focus();
  }, [replyingTo?.id]);

  // Cresce com o texto até um limite; depois rola.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [draft]);

  const patchPending = (key: string, patch: Partial<PendingFile>) =>
    setPending((list) => list.map((image) => (image.key === key ? { ...image, ...patch } : image)));

  function addFiles(files: File[]) {
    if (!canSend || files.length === 0) return;
    const room = MAX_ATTACHMENTS_PER_MESSAGE - pendingRef.current.length;
    const problems: string[] = [];
    if (files.length > room) problems.push(`Até ${MAX_ATTACHMENTS_PER_MESSAGE} arquivos por mensagem.`);
    const accepted: PendingFile[] = [];
    for (const file of files.slice(0, Math.max(room, 0))) {
      const problem = checkFile(file);
      if (problem) {
        problems.push(problem);
        continue;
      }
      const key = crypto.randomUUID();
      const upload = actions.uploadFile(file, (progress) => patchPending(key, { progress }));
      // Só imagens pequenas ganham miniatura (as outras o servidor trata como arquivo).
      const previewUrl = ATTACHMENT_TYPES_SET.has(file.type) && file.size <= MAX_IMAGE_BYTES ? URL.createObjectURL(file) : null;
      accepted.push({ key, file, previewUrl, progress: 0, attachment: null, error: null, upload });
      void upload.done.then((res) =>
        patchPending(key, res.ok ? { attachment: res.attachment, progress: 1, upload: null } : { error: res.error, upload: null }),
      );
    }
    setPending((list) => [...list, ...accepted]);
    setError(problems[0] ?? null);
  }

  function removePending(key: string) {
    const image = pendingRef.current.find((i) => i.key === key);
    if (image) discard(image);
    setPending((list) => list.filter((i) => i.key !== key));
  }

  // Arrastar arquivos para qualquer parte da conversa (a <section> em volta), não só para a caixa de texto.
  useEffect(() => {
    const zone = formRef.current?.closest('section');
    if (!zone || !canSend) return;
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false;
    let depth = 0;
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'copy';
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      addFiles([...e.dataTransfer!.files]);
      textareaRef.current?.focus();
    };
    zone.addEventListener('dragenter', onEnter);
    zone.addEventListener('dragleave', onLeave);
    zone.addEventListener('dragover', onOver);
    zone.addEventListener('drop', onDrop);
    return () => {
      zone.removeEventListener('dragenter', onEnter);
      zone.removeEventListener('dragleave', onLeave);
      zone.removeEventListener('dragover', onOver);
      zone.removeEventListener('drop', onDrop);
    };
  });

  const uploading = pending.some((i) => i.upload !== null);
  const failed = pending.some((i) => i.error !== null);
  const ready = pending.filter((i) => i.attachment);
  const canSubmit = canSend && !sending && !uploading && !failed && (draft.trim() !== '' || ready.length > 0);

  async function submit() {
    if (!canSubmit) return;
    const content = encodeMentions(draft.trim(), candidates);
    setSending(true);
    const err = await actions.sendMessage(
      targetId,
      content,
      ready.map((i) => i.attachment!.id),
      replyingTo?.id,
    );
    setSending(false);
    setError(err);
    if (!err) {
      actions.cancelReply();
      setDraft('');
      for (const item of pending) if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      setPending([]);
    }
  }

  return (
    <>
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="relative px-4 pt-1"
    >
      {dragging && (
        <div
          aria-hidden
          className="pointer-events-none absolute right-4 bottom-full left-4 mb-2 rounded-lg border-2 border-dashed border-accent bg-panel/90 py-6 text-center text-sm font-medium text-accent"
        >
          Solte para anexar a {label}
        </div>
      )}
      {autocomplete.popup}

      <div className="rounded-lg bg-elevated focus-within:ring-1 focus-within:ring-accent/60">
        {replyingTo && (
          <div className="flex items-center gap-2 border-b border-line px-4 py-1.5 text-sm text-muted">
            <CornerUpRight size={14} className="shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 truncate">
              Respondendo a{' '}
              <span className="font-medium text-fg">{displayNameOf(state.snapshot, state.users, replyingTo.authorId)}</span>
              {replyingTo.content ? (
                <>
                  : <Markup content={replyingTo.content.replace(/\s+/g, ' ').slice(0, 120)} />
                </>
              ) : (
                ' (anexo)'
              )}
            </span>
            <button
              type="button"
              onClick={actions.cancelReply}
              aria-label="Cancelar resposta"
              title="Cancelar resposta (Esc)"
              className="shrink-0 rounded p-1 text-faint hover:bg-hover hover:text-fg"
            >
              <X size={14} />
            </button>
          </div>
        )}
        {pending.length > 0 && (
          <ul aria-label="Anexos" className="flex gap-3 overflow-x-auto border-b border-line px-4 pt-3 pb-2">
            {pending.map((image) => (
              <PendingTile key={image.key} image={image} onRemove={() => removePending(image.key)} />
            ))}
          </ul>
        )}
        <div className="flex items-end gap-2 px-3 py-2.5">
          <button
            type="button"
            title={`Anexar arquivo (fica ${ATTACHMENT_RETENTION_DAYS} dias no servidor)`}
            aria-label="Anexar arquivo"
            disabled={!canSend || pending.length >= MAX_ATTACHMENTS_PER_MESSAGE}
            onClick={() => fileInputRef.current?.click()}
            className="rounded p-1 text-muted hover:text-fg disabled:opacity-40 disabled:hover:text-muted"
          >
            <Paperclip size={20} />
          </button>
          <div ref={extrasRef} className="relative">
            <button
              type="button"
              title="Criar enquete ou roleta"
              aria-label="Criar enquete ou roleta"
              aria-haspopup="menu"
              aria-expanded={extrasOpen}
              disabled={!canSend}
              onClick={() => setExtrasOpen((open) => !open)}
              className="rounded p-1 text-muted hover:text-fg disabled:opacity-40 disabled:hover:text-muted"
            >
              <ChartNoAxesColumn size={20} />
            </button>
            {extrasOpen && (
              <div role="menu" className="absolute bottom-full left-0 z-20 mb-2 w-60 rounded-lg border border-line bg-panel p-1 shadow-xl">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setExtrasOpen(false);
                    setDialog('poll');
                  }}
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-hover"
                >
                  <ChartNoAxesColumn size={18} className="shrink-0 text-muted" aria-hidden />
                  <span>
                    <span className="block text-sm font-medium">Enquete</span>
                    <span className="block text-xs text-muted">Uma pergunta e votos por clique</span>
                  </span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setExtrasOpen(false);
                    setDialog('roulette');
                  }}
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-hover"
                >
                  <LoaderPinwheel size={18} className="shrink-0 text-muted" aria-hidden />
                  <span>
                    <span className="block text-sm font-medium">Roleta</span>
                    <span className="block text-xs text-muted">Gira e sorteia uma opção</span>
                  </span>
                </button>
              </div>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              addFiles([...(e.target.files ?? [])]);
              e.target.value = ''; // permite escolher o mesmo arquivo de novo
            }}
          />
          <textarea
            ref={textareaRef}
            rows={1}
            value={draft}
            maxLength={MAX_MESSAGE_LENGTH}
            disabled={!canSend}
            aria-label={`Mensagem para ${label}`}
            placeholder={
              canSend ? `Conversar em ${label}` : 'Você não tem permissão para enviar mensagens aqui.'
            }
            {...autocomplete.inputProps}
            onChange={(e) => {
              setDraft(e.target.value);
              autocomplete.inputProps.onChange();
              if (e.target.value.trim()) actions.notifyTyping(targetId);
            }}
            onPaste={(e) => {
              const files = [...e.clipboardData.files];
              if (files.length === 0) return; // texto colado segue normal
              e.preventDefault();
              addFiles(files);
            }}
            onKeyDown={(e) => {
              if (autocomplete.handleKeyDown(e)) return;
              if (e.key === 'Escape' && replyingTo) {
                e.preventDefault();
                actions.cancelReply();
                return;
              }
              // Enter envia; Shift+Enter quebra linha; não interfere na composição de acentos (IME).
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void submit();
              }
            }}
            className="flex-1 resize-none bg-transparent py-0.5 text-[length:var(--message-font-size)] leading-6 placeholder:text-faint focus:outline-none disabled:cursor-not-allowed"
          />
          <button
            type="submit"
            aria-label="Enviar mensagem"
            title={uploading ? 'Aguarde o envio das imagens' : undefined}
            disabled={!canSubmit}
            className="rounded p-1 text-muted hover:text-accent disabled:opacity-40 disabled:hover:text-muted"
          >
            <SendHorizontal size={20} />
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-1 text-xs text-dnd">
          {error}
        </p>
      )}
    </form>
    {/* Fora do formulário do campo de texto: um formulário dentro do outro não é válido. */}
    {dialog === 'poll' && <CreatePollDialog targetId={targetId} onClose={() => setDialog(null)} />}
    {dialog === 'roulette' && <CreateRouletteDialog targetId={targetId} onClose={() => setDialog(null)} />}
    </>
  );
}

function discard(image: PendingFile): void {
  image.upload?.abort();
  if (image.previewUrl) URL.revokeObjectURL(image.previewUrl);
}

function PendingTile({ image, onRemove }: { image: PendingFile; onRemove: () => void }) {
  const status = image.error ?? (image.upload ? `Enviando… ${Math.round(image.progress * 100)}%` : 'Pronto para enviar');
  const busy = image.upload !== null;
  return (
    <li className="relative shrink-0" title={`${image.file.name} — ${status}`}>
      {image.previewUrl ? (
        <img
          src={image.previewUrl}
          alt={image.file.name}
          className={`h-20 w-20 rounded-md object-cover ${busy || image.error ? 'opacity-50' : ''}`}
        />
      ) : (
        <div className={`flex h-20 w-44 items-center gap-2 rounded-md bg-rail px-3 ${busy || image.error ? 'opacity-50' : ''}`}>
          <FileIcon name={image.file.name} size={26} className="shrink-0 text-muted" />
          <span className="min-w-0 text-xs">
            <span className="block truncate font-medium">{image.file.name}</span>
            <span className="block text-faint">{formatBytes(image.file.size)}</span>
          </span>
        </div>
      )}
      {busy && image.previewUrl && (
        <span className="absolute inset-0 flex items-center justify-center">
          <LoaderCircle size={22} className="animate-spin text-fg" aria-label={status} />
        </span>
      )}
      {busy && (
        <span aria-hidden className="absolute right-1 bottom-1 left-1 h-1 overflow-hidden rounded-full bg-rail/80">
          <span className="block h-full bg-accent transition-[width]" style={{ width: `${image.progress * 100}%` }} />
        </span>
      )}
      {image.error && (
        <span className="absolute inset-0 flex items-center justify-center">
          <TriangleAlert size={22} className="text-dnd" aria-label={image.error} />
        </span>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remover ${image.file.name}`}
        className="absolute -top-2 -right-2 rounded-full border-2 border-elevated bg-dnd p-0.5 text-white hover:bg-dnd/85"
      >
        <X size={12} />
      </button>
      {image.error && <p className={`mt-1 truncate text-[10px] text-dnd ${image.previewUrl ? 'w-20' : 'w-44'}`}>{image.error}</p>}
    </li>
  );
}

import type { Id } from '@shared/models';
import { SendHorizontal } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useRealtime } from '../state/realtime';

const MAX_LENGTH = 2000;
const MAX_HEIGHT_PX = 192;

interface MessageInputProps {
  /** Canal de texto ou conversa direta. */
  targetId: Id;
  /** Como o destino aparece no texto de ajuda: "#geral" ou "@Bruno". */
  label: string;
  canSend: boolean;
}

export function MessageInput({ targetId, label, canSend }: MessageInputProps) {
  const { actions } = useRealtime();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setDraft('');
    setError(null);
    textareaRef.current?.focus();
  }, [targetId]);

  // Cresce com o texto até um limite; depois rola.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [draft]);

  async function submit() {
    const content = draft.trim();
    if (!content || sending || !canSend) return;
    setSending(true);
    const err = await actions.sendMessage(targetId, content);
    setSending(false);
    setError(err);
    if (!err) setDraft('');
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="px-4 pt-1"
    >
      <div className="flex items-end gap-2 rounded-lg bg-elevated px-4 py-2.5 focus-within:ring-1 focus-within:ring-accent/60">
        <textarea
          ref={textareaRef}
          rows={1}
          value={draft}
          maxLength={MAX_LENGTH}
          disabled={!canSend}
          aria-label={`Mensagem para ${label}`}
          placeholder={
            canSend ? `Conversar em ${label}` : 'Você não tem permissão para enviar mensagens aqui.'
          }
          onChange={(e) => {
            setDraft(e.target.value);
            if (e.target.value.trim()) actions.notifyTyping(targetId);
          }}
          onKeyDown={(e) => {
            // Enter envia; Shift+Enter quebra linha; não interfere na composição de acentos (IME).
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
          className="flex-1 resize-none bg-transparent text-[15px] leading-6 placeholder:text-faint focus:outline-none disabled:cursor-not-allowed"
        />
        <button
          type="submit"
          aria-label="Enviar mensagem"
          disabled={!canSend || sending || !draft.trim()}
          className="rounded p-1 text-muted hover:text-accent disabled:opacity-40 disabled:hover:text-muted"
        >
          <SendHorizontal size={20} />
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-1 text-xs text-dnd">
          {error}
        </p>
      )}
    </form>
  );
}

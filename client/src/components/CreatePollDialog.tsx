import type { Id } from '@shared/models';
import { checkPoll, MAX_POLL_OPTION_LENGTH, MAX_POLL_OPTIONS, MAX_POLL_QUESTION, MIN_POLL_OPTIONS } from '@shared/polls';
import { Plus, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useRealtime } from '../state/realtime';
import { DialogActions, fieldClass, labelClass, Modal } from './Modal';

export function CreatePollDialog({ targetId, onClose }: { targetId: Id; onClose: () => void }) {
  const { actions } = useRealtime();
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [multiple, setMultiple] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const checked = checkPoll({ question, options, multiple });
  const filled = options.filter((o) => o.trim()).length;

  const setOption = (index: number, value: string) => setOptions((all) => all.map((o, i) => (i === index ? value : o)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!checked.ok || busy) return;
    setBusy(true);
    const err = await actions.createPoll(targetId, checked.value);
    setBusy(false);
    if (err) setError(err);
    else onClose();
  }

  // Só mostra o motivo quando a pessoa já preencheu o bastante para o motivo fazer sentido.
  const hint = error ?? (!checked.ok && question.trim() && filled >= MIN_POLL_OPTIONS ? checked.error : null);

  return (
    <Modal title="Criar enquete" description="Todo mundo vota com um clique, sem encher o chat." onClose={onClose}>
      <form onSubmit={submit}>
        <label htmlFor="poll-question" className={labelClass}>
          Pergunta
        </label>
        <input
          id="poll-question"
          data-autofocus
          value={question}
          maxLength={MAX_POLL_QUESTION}
          placeholder="Que jogo hoje?"
          onChange={(e) => setQuestion(e.target.value)}
          className={fieldClass}
        />

        <fieldset className="mt-4">
          <legend className={labelClass}>Opções</legend>
          <ul className="mt-2 space-y-2">
            {options.map((option, i) => (
              <li key={i} className="flex items-center gap-2">
                <input
                  value={option}
                  maxLength={MAX_POLL_OPTION_LENGTH}
                  aria-label={`Opção ${i + 1}`}
                  placeholder={`Opção ${i + 1}`}
                  onChange={(e) => setOption(i, e.target.value)}
                  className="w-full rounded-md bg-rail px-3 py-2 text-fg outline-none placeholder:text-faint focus:ring-2 focus:ring-accent"
                />
                {options.length > MIN_POLL_OPTIONS && (
                  <button
                    type="button"
                    aria-label={`Remover opção ${i + 1}`}
                    onClick={() => setOptions((all) => all.filter((_, j) => j !== i))}
                    className="shrink-0 rounded p-1.5 text-faint hover:bg-hover hover:text-fg"
                  >
                    <X size={16} />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {options.length < MAX_POLL_OPTIONS && (
            <button
              type="button"
              onClick={() => setOptions((all) => [...all, ''])}
              className="mt-2 flex items-center gap-1 text-sm text-muted hover:text-fg"
            >
              <Plus size={15} aria-hidden /> Adicionar opção
            </button>
          )}
        </fieldset>

        <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={multiple}
            onChange={(e) => setMultiple(e.target.checked)}
            className="h-4 w-4 accent-[var(--color-accent)]"
          />
          Permitir marcar várias respostas
        </label>

        {hint && (
          <p role="alert" className="mt-2 text-sm text-dnd">
            {hint}
          </p>
        )}
        <DialogActions onCancel={onClose} submitLabel="Criar enquete" disabled={!checked.ok || busy} />
      </form>
    </Modal>
  );
}

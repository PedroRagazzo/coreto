import type { Id } from '@shared/models';
import {
  checkRoulette,
  MAX_ROULETTE_OPTION_LENGTH,
  MAX_ROULETTE_OPTIONS,
  MAX_ROULETTE_TITLE,
  MIN_ROULETTE_OPTIONS,
} from '@shared/polls';
import { useState, type FormEvent } from 'react';
import { useRealtime } from '../state/realtime';
import { DialogActions, fieldClass, labelClass, Modal } from './Modal';

interface CreateRouletteDialogProps {
  targetId: Id;
  /** Começa com estes textos (para repetir uma roleta que já foi girada). */
  initial?: { title: string; options: string[] };
  onClose: () => void;
}

export function CreateRouletteDialog({ targetId, initial, onClose }: CreateRouletteDialogProps) {
  const { actions } = useRealtime();
  const [title, setTitle] = useState(initial?.title ?? '');
  const [text, setText] = useState(initial?.options.join('\n') ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Uma opção por linha; linhas vazias não contam.
  const options = text.split('\n');
  const checked = checkRoulette({ title, options });
  const filled = options.filter((o) => o.trim()).length;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!checked.ok || busy) return;
    setBusy(true);
    const err = await actions.createRoulette(targetId, checked.value);
    setBusy(false);
    if (err) setError(err);
    else onClose();
  }

  return (
    <Modal title="Criar roleta" description="Escreva as opções, uma por linha. Quando alguém girar, ela sorteia uma só." onClose={onClose}>
      <form onSubmit={submit}>
        <label htmlFor="roulette-title" className={labelClass}>
          Título (opcional)
        </label>
        <input
          id="roulette-title"
          value={title}
          maxLength={MAX_ROULETTE_TITLE}
          placeholder="Que jogo hoje?"
          onChange={(e) => setTitle(e.target.value)}
          className={fieldClass}
        />

        <label htmlFor="roulette-options" className={`${labelClass} mt-4`}>
          Opções
        </label>
        <textarea
          id="roulette-options"
          data-autofocus
          value={text}
          rows={8}
          placeholder={'Minecraft\nValorant\nAmong Us'}
          onChange={(e) => setText(e.target.value)}
          className={`${fieldClass} resize-y leading-6`}
        />
        <p className="mt-1 text-xs text-faint">
          {filled} {filled === 1 ? 'opção' : 'opções'} (de {MIN_ROULETTE_OPTIONS} a {MAX_ROULETTE_OPTIONS}, até {MAX_ROULETTE_OPTION_LENGTH} letras cada).
          Repetir uma opção dá mais chance a ela.
        </p>

        {(error ?? (!checked.ok && filled >= MIN_ROULETTE_OPTIONS ? checked.error : null)) && (
          <p role="alert" className="mt-2 text-sm text-dnd">
            {error ?? (!checked.ok ? checked.error : null)}
          </p>
        )}
        <DialogActions onCancel={onClose} submitLabel="Criar roleta" disabled={!checked.ok || busy} />
      </form>
    </Modal>
  );
}

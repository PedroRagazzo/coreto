import { MAX_SPACE_NAME, normalizeSpaceName } from '@shared/names';
import { useState, type FormEvent } from 'react';
import { useRealtime } from '../state/realtime';
import { DialogActions, fieldClass, labelClass, Modal } from './Modal';

export function CreateSpaceDialog({ onClose }: { onClose: () => void }) {
  const { actions } = useRealtime();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const normalized = normalizeSpaceName(name);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!normalized || busy) return;
    setBusy(true);
    const err = await actions.createSpace(normalized);
    setBusy(false);
    if (err) setError(err);
    else onClose();
  }

  return (
    <Modal
      title="Criar um espaço"
      description="Você será o dono. Espaços são públicos: todo mundo vira membro e vê o espaço na barra lateral."
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <label htmlFor="space-name" className={labelClass}>
          Nome do espaço
        </label>
        <input
          id="space-name"
          data-autofocus
          value={name}
          maxLength={MAX_SPACE_NAME}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex.: Grupo de estudos"
          className={fieldClass}
        />
        <p className="mt-2 text-xs text-faint">O espaço já vem com o canal #geral e uma sala de voz.</p>
        {error && (
          <p role="alert" className="mt-2 text-sm text-dnd">
            {error}
          </p>
        )}
        <DialogActions onCancel={onClose} submitLabel={busy ? 'Criando…' : 'Criar espaço'} disabled={!normalized || busy} />
      </form>
    </Modal>
  );
}

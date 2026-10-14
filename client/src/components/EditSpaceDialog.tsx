import type { Space } from '@shared/models';
import { MAX_SPACE_NAME, normalizeSpaceName } from '@shared/names';
import { useState, type FormEvent } from 'react';
import { useRealtime } from '../state/realtime';
import { DialogActions, fieldClass, labelClass, Modal } from './Modal';

interface EditSpaceDialogProps {
  space: Space;
  /** Só o dono vê a opção de excluir. */
  canDelete: boolean;
  onClose: () => void;
}

export function EditSpaceDialog({ space, canDelete, onClose }: EditSpaceDialogProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  return confirmingDelete ? (
    <DeleteSpaceConfirmation space={space} onCancel={() => setConfirmingDelete(false)} onClose={onClose} />
  ) : (
    <EditSpaceForm
      space={space}
      onDelete={canDelete ? () => setConfirmingDelete(true) : undefined}
      onClose={onClose}
    />
  );
}

interface EditSpaceFormProps {
  space: Space;
  onDelete?: () => void;
  onClose: () => void;
}

function EditSpaceForm({ space, onDelete, onClose }: EditSpaceFormProps) {
  const { actions } = useRealtime();
  const [name, setName] = useState(space.name);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const normalized = normalizeSpaceName(name);
  const changed = normalized !== space.name;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!normalized || !changed || busy) return;
    setBusy(true);
    const err = await actions.renameSpace(normalized);
    setBusy(false);
    if (err) setError(err);
    else onClose();
  }

  return (
    <Modal title="Configurações do espaço" description={space.name} onClose={onClose}>
      <form onSubmit={submit}>
        <label htmlFor="edit-space-name" className={labelClass}>
          Nome do espaço
        </label>
        <input
          id="edit-space-name"
          data-autofocus
          value={name}
          maxLength={MAX_SPACE_NAME}
          onChange={(e) => setName(e.target.value)}
          className={fieldClass}
        />
        {error && (
          <p role="alert" className="mt-3 text-sm text-dnd">
            {error}
          </p>
        )}
        <DialogActions
          onCancel={onClose}
          submitLabel={busy ? 'Salvando…' : 'Salvar'}
          disabled={!normalized || !changed || busy}
          leading={
            onDelete && (
              <button type="button" onClick={onDelete} className="rounded-md px-2 py-2 text-sm font-medium text-dnd hover:underline">
                Excluir espaço
              </button>
            )
          }
        />
      </form>
    </Modal>
  );
}

interface DeleteSpaceConfirmationProps {
  space: Space;
  onCancel: () => void;
  onClose: () => void;
}

function DeleteSpaceConfirmation({ space, onCancel, onClose }: DeleteSpaceConfirmationProps) {
  const { actions } = useRealtime();
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Exige digitar o nome: a exclusão apaga tudo de todos os membros.
  const confirmed = typed.trim() === space.name;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!confirmed || busy) return;
    setBusy(true);
    const err = await actions.deleteSpace();
    setBusy(false);
    if (err) setError(err);
    else onClose();
  }

  return (
    <Modal title="Excluir espaço" onClose={onCancel}>
      <form onSubmit={submit}>
        <p className="text-muted">
          Isso apaga <strong className="text-fg">{space.name}</strong> para todos os membros: canais, mensagens e cargos.
          Quem estiver numa sala de voz do espaço será desconectado. Isso não pode ser desfeito.
        </p>
        <label htmlFor="confirm-space-name" className={`${labelClass} mt-5`}>
          Digite o nome do espaço para confirmar
        </label>
        <input
          id="confirm-space-name"
          data-autofocus
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={space.name}
          autoComplete="off"
          className={fieldClass}
        />
        {error && (
          <p role="alert" className="mt-3 text-sm text-dnd">
            {error}
          </p>
        )}
        <DialogActions
          onCancel={onCancel}
          submitLabel={busy ? 'Excluindo…' : 'Excluir espaço'}
          disabled={!confirmed || busy}
          danger
        />
      </form>
    </Modal>
  );
}

import { useState, type FormEvent } from 'react';
import { useRealtime } from '../state/realtime';
import { DialogActions, fieldClass, labelClass, Modal } from './Modal';

interface DeleteAccountDialogProps {
  userId: string;
  name: string;
  onClose: () => void;
}

/** Só o administrador geral chega aqui: exclui a conta de alguém, com tudo dela. Pede o nome da pessoa para confirmar. */
export function DeleteAccountDialog({ userId, name, onClose }: DeleteAccountDialogProps) {
  const { actions } = useRealtime();
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const confirmed = typed.trim().toLocaleLowerCase('pt-BR') === name.trim().toLocaleLowerCase('pt-BR');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!confirmed || busy) return;
    setBusy(true);
    const err = await actions.deleteAccount(userId);
    setBusy(false);
    if (err) setError(err);
    else onClose();
  }

  return (
    <Modal title="Excluir conta" onClose={onClose}>
      <form onSubmit={submit}>
        <p className="text-muted">
          Isso apaga a conta de <strong className="text-fg">{name}</strong> para sempre: as mensagens, reações e arquivos dela somem
          de todos os espaços e as conversas diretas com ela são apagadas. Os espaços que ela criou passam para você. Isso não pode
          ser desfeito.
        </p>
        <label htmlFor="confirm-account-name" className={`${labelClass} mt-5`}>
          Digite o nome da pessoa para confirmar
        </label>
        <input
          id="confirm-account-name"
          data-autofocus
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={name}
          autoComplete="off"
          className={fieldClass}
        />
        {error && (
          <p role="alert" className="mt-3 text-sm text-dnd">
            {error}
          </p>
        )}
        <DialogActions onCancel={onClose} submitLabel={busy ? 'Excluindo…' : 'Excluir conta'} disabled={!confirmed || busy} danger />
      </form>
    </Modal>
  );
}

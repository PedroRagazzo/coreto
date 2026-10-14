import type { Channel, Id } from '@shared/models';
import { MAX_CHANNEL_NAME, MAX_CHANNEL_TOPIC, normalizeChannelName, normalizeTopic } from '@shared/names';
import type { UpdateChannelRequest } from '@shared/protocol';
import { Hash, Volume2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useRealtime } from '../state/realtime';
import { DialogActions, fieldClass, labelClass, Modal } from './Modal';

export function EditChannelDialog({ channel, onClose }: { channel: Channel; onClose: () => void }) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  return confirmingDelete ? (
    <DeleteChannelConfirmation channel={channel} onCancel={() => setConfirmingDelete(false)} onClose={onClose} />
  ) : (
    <EditChannelForm channel={channel} onDelete={() => setConfirmingDelete(true)} onClose={onClose} />
  );
}

interface EditChannelFormProps {
  channel: Channel;
  onDelete: () => void;
  onClose: () => void;
}

function EditChannelForm({ channel, onDelete, onClose }: EditChannelFormProps) {
  const { state, actions } = useRealtime();
  const [name, setName] = useState(channel.name);
  const [topic, setTopic] = useState(channel.topic ?? '');
  const [categoryId, setCategoryId] = useState<Id | null>(channel.categoryId);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isText = channel.kind === 'text';
  const normalized = normalizeChannelName(name, channel.kind);
  const Icon = isText ? Hash : Volume2;

  // Só envia o que mudou.
  const patch: UpdateChannelRequest = { channelId: channel.id };
  if (normalized !== channel.name) patch.name = normalized;
  if (isText && normalizeTopic(topic) !== channel.topic) patch.topic = normalizeTopic(topic);
  if (categoryId !== channel.categoryId) patch.categoryId = categoryId;
  const changed = Object.keys(patch).length > 1;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!normalized || !changed || busy) return;
    setBusy(true);
    const err = await actions.updateChannel(patch);
    setBusy(false);
    if (err) setError(err);
    else onClose();
  }

  return (
    <Modal title="Editar canal" description={`${isText ? '#' : ''}${channel.name}`} onClose={onClose}>
      <form onSubmit={submit}>
        <label htmlFor="edit-channel-name" className={labelClass}>
          Nome do canal
        </label>
        <div className="relative">
          <Icon size={18} className="pointer-events-none absolute top-1/2 left-3 mt-1 -translate-y-1/2 text-faint" />
          <input
            id="edit-channel-name"
            data-autofocus
            value={name}
            maxLength={MAX_CHANNEL_NAME}
            onChange={(e) => setName(e.target.value)}
            className={`${fieldClass} pl-9`}
          />
        </div>
        {isText && normalized && normalized !== name.trim() && (
          <p className="mt-2 text-xs text-faint">Vai ficar como #{normalized}</p>
        )}

        {isText && (
          <>
            <label htmlFor="edit-channel-topic" className={`${labelClass} mt-5`}>
              Tópico
            </label>
            <textarea
              id="edit-channel-topic"
              rows={2}
              value={topic}
              maxLength={MAX_CHANNEL_TOPIC}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Sobre o que se conversa aqui? Aparece no cabeçalho do canal."
              className={`${fieldClass} resize-none`}
            />
          </>
        )}

        <label htmlFor="edit-channel-category" className={`${labelClass} mt-5`}>
          Categoria
        </label>
        <select
          id="edit-channel-category"
          value={categoryId ?? ''}
          onChange={(e) => setCategoryId(e.target.value || null)}
          className={fieldClass}
        >
          <option value="">Sem categoria</option>
          {state.snapshot?.categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>

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
            <button type="button" onClick={onDelete} className="rounded-md px-2 py-2 text-sm font-medium text-dnd hover:underline">
              Excluir canal
            </button>
          }
        />
      </form>
    </Modal>
  );
}

interface DeleteChannelConfirmationProps {
  channel: Channel;
  onCancel: () => void;
  onClose: () => void;
}

function DeleteChannelConfirmation({ channel, onCancel, onClose }: DeleteChannelConfirmationProps) {
  const { actions } = useRealtime();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const label = channel.kind === 'text' ? `#${channel.name}` : channel.name;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const err = await actions.deleteChannel(channel.id);
    setBusy(false);
    if (err) setError(err);
    else onClose();
  }

  return (
    <Modal title="Excluir canal" onClose={onCancel}>
      <form onSubmit={submit}>
        <p className="text-muted">
          Tem certeza que quer excluir <strong className="text-fg">{label}</strong>?{' '}
          {channel.kind === 'text'
            ? 'Todas as mensagens do canal serão apagadas.'
            : 'Quem estiver na sala será desconectado.'}{' '}
          Isso não pode ser desfeito.
        </p>
        {error && (
          <p role="alert" className="mt-3 text-sm text-dnd">
            {error}
          </p>
        )}
        <DialogActions onCancel={onCancel} submitLabel={busy ? 'Excluindo…' : 'Excluir canal'} disabled={busy} danger />
      </form>
    </Modal>
  );
}

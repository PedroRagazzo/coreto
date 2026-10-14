import type { ChannelKind, Id } from '@shared/models';
import { MAX_CHANNEL_NAME, normalizeChannelName } from '@shared/names';
import { Hash, Volume2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useRealtime } from '../state/realtime';
import { DialogActions, fieldClass, labelClass, Modal } from './Modal';

const KINDS: { kind: ChannelKind; label: string; hint: string; Icon: typeof Hash }[] = [
  { kind: 'text', label: 'Texto', hint: 'Mensagens, avisos e conversas', Icon: Hash },
  { kind: 'voice', label: 'Voz', hint: 'Conversa por áudio em grupo', Icon: Volume2 },
];

interface CreateChannelDialogProps {
  /** Categoria pré-selecionada (o "+" ao lado de uma categoria). */
  initialCategoryId: Id | null;
  onClose: () => void;
}

export function CreateChannelDialog({ initialCategoryId, onClose }: CreateChannelDialogProps) {
  const { state, actions } = useRealtime();
  const snapshot = state.snapshot;
  const categories = snapshot?.categories ?? [];

  // Numa categoria que só tem salas de voz, o tipo padrão é voz.
  const [kind, setKind] = useState<ChannelKind>(() => {
    const inCategory = snapshot?.channels.filter((c) => c.categoryId === initialCategoryId) ?? [];
    return inCategory.length > 0 && inCategory.every((c) => c.kind === 'voice') ? 'voice' : 'text';
  });
  const [categoryId, setCategoryId] = useState<Id | null>(initialCategoryId);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const normalized = normalizeChannelName(name, kind);
  const Icon = kind === 'text' ? Hash : Volume2;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!normalized || busy) return;
    setBusy(true);
    const err = await actions.createChannel({ categoryId, name: normalized, kind });
    setBusy(false);
    if (err) setError(err);
    else onClose();
  }

  return (
    <Modal title="Criar canal" description={snapshot ? `Em ${snapshot.space.name}` : undefined} onClose={onClose}>
      <form onSubmit={submit}>
        <fieldset>
          <legend className={labelClass}>Tipo</legend>
          <div className="mt-2 space-y-2">
            {KINDS.map(({ kind: option, label, hint, Icon: OptionIcon }) => (
              <label
                key={option}
                className={`flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 ${
                  kind === option ? 'bg-hover ring-1 ring-accent/60' : 'bg-rail hover:bg-hover/60'
                }`}
              >
                <OptionIcon size={22} className="shrink-0 text-muted" />
                <span className="flex-1">
                  <span className="block font-medium">{label}</span>
                  <span className="block text-xs text-muted">{hint}</span>
                </span>
                <input
                  type="radio"
                  name="channel-kind"
                  value={option}
                  checked={kind === option}
                  onChange={() => setKind(option)}
                  className="h-4 w-4 accent-[var(--color-accent)]"
                />
              </label>
            ))}
          </div>
        </fieldset>

        <label htmlFor="channel-name" className={`${labelClass} mt-5`}>
          Nome do canal
        </label>
        <div className="relative">
          <Icon size={18} className="pointer-events-none absolute top-1/2 left-3 mt-1 -translate-y-1/2 text-faint" />
          <input
            id="channel-name"
            data-autofocus
            value={name}
            maxLength={MAX_CHANNEL_NAME}
            onChange={(e) => setName(e.target.value)}
            placeholder={kind === 'text' ? 'novo-canal' : 'Nova sala'}
            className={`${fieldClass} pl-9`}
          />
        </div>
        {kind === 'text' && normalized && normalized !== name.trim() && (
          <p className="mt-2 text-xs text-faint">Será criado como #{normalized}</p>
        )}

        <label htmlFor="channel-category" className={`${labelClass} mt-5`}>
          Categoria
        </label>
        <select
          id="channel-category"
          value={categoryId ?? ''}
          onChange={(e) => setCategoryId(e.target.value || null)}
          className={fieldClass}
        >
          <option value="">Sem categoria</option>
          {categories.map((category) => (
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
        <DialogActions onCancel={onClose} submitLabel={busy ? 'Criando…' : 'Criar canal'} disabled={!normalized || busy} />
      </form>
    </Modal>
  );
}

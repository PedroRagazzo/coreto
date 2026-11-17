import type { Id, Member, User } from '@shared/models';
import { isTagColor, MAX_TAG, normalizeTag, TAG_COLORS } from '@shared/names';
import { useState, type FormEvent } from 'react';
import { useRealtime } from '../state/realtime';
import { displayNameOf, tagOf } from '../state/selectors';
import { Avatar } from './Avatar';
import { fieldClass, labelClass } from './Modal';

const DEFAULT_COLOR = TAG_COLORS[0];

/** Aba "Etiquetas" das configurações do espaço: os administradores dão, trocam e tiram a etiqueta de quem quiserem. */
export function MemberTagsTab() {
  const { state } = useRealtime();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Id | null>(null);
  const { snapshot } = state;
  if (!snapshot) return null;

  const needle = query.trim().toLocaleLowerCase('pt-BR');
  const rows = snapshot.members
    .flatMap((member) => {
      const user = state.users[member.userId];
      return user
        ? [
            {
              member,
              user,
              name: displayNameOf(snapshot, state.users, member.userId),
            },
          ]
        : [];
    })
    .filter((r) => !needle || r.name.toLocaleLowerCase('pt-BR').includes(needle))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  return (
    <div>
      <p className="text-sm text-muted">
        A etiqueta aparece ao lado do nome, como a do <strong className="text-fg">ROBÔ</strong>, nas mensagens e na lista de membros deste
        espaço.
      </p>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Buscar alguém"
        aria-label="Buscar alguém"
        className={fieldClass}
      />
      <ul className="mt-3 max-h-80 overflow-y-auto" aria-label="Membros">
        {rows.map(({ member, user, name }) => (
          <li key={user.id} className="border-b border-white/5 last:border-0">
            <div className="flex items-center gap-3 py-2">
              <Avatar name={name} color={user.avatarColor} size="sm" />
              <span className="min-w-0 truncate font-medium">{name}</span>
              <CurrentTag user={user} />
              <button
                type="button"
                onClick={() => setEditing(editing === user.id ? null : user.id)}
                aria-expanded={editing === user.id}
                aria-label={`Editar a etiqueta de ${name}`}
                className="ml-auto shrink-0 rounded-md px-2 py-1 text-sm font-medium text-accent hover:underline"
              >
                {editing === user.id ? 'Fechar' : 'Editar'}
              </button>
            </div>
            {editing === user.id && <TagEditor key={user.id} member={member} user={user} name={name} onDone={() => setEditing(null)} />}
          </li>
        ))}
        {rows.length === 0 && <li className="py-3 text-sm text-muted">Ninguém com esse nome.</li>}
      </ul>
    </div>
  );
}

function CurrentTag({ user }: { user: User }) {
  const { state } = useRealtime();
  const tag = tagOf(state.snapshot, user);
  if (!tag) return null;
  return (
    <span
      className={`shrink-0 rounded px-1 text-[10px] font-semibold text-white ${tag.color ? '' : 'bg-accent'}`}
      style={tag.color ? { backgroundColor: tag.color } : undefined}
    >
      {tag.text}
    </span>
  );
}

interface TagEditorProps {
  member: Member;
  user: User;
  name: string;
  onDone: () => void;
}

function TagEditor({ member, user, name, onDone }: TagEditorProps) {
  const { actions } = useRealtime();
  const [text, setText] = useState(member.tag ?? '');
  const [color, setColor] = useState<string>(isTagColor(member.tagColor) ? member.tagColor : DEFAULT_COLOR);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const normalized = normalizeTag(text);
  const changed = normalized !== member.tag || (normalized !== null && color !== (member.tagColor ?? DEFAULT_COLOR));

  async function save(tag: string | null) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const err = await actions.setMemberTag(user.id, tag, tag ? color : null);
    setBusy(false);
    if (err) setError(err);
    else onDone();
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (normalized && changed) void save(normalized);
  }

  return (
    <form onSubmit={submit} className="mb-3 rounded-lg bg-rail p-3">
      <label htmlFor={`tag-text-${user.id}`} className={labelClass}>
        Etiqueta de {name}
      </label>
      <input
        id={`tag-text-${user.id}`}
        data-autofocus
        value={text}
        maxLength={MAX_TAG}
        onChange={(e) => setText(e.target.value)}
        placeholder={user.isBot ? 'ROBÔ' : 'Ex.: AMIGO, MOD, VIP'}
        autoComplete="off"
        className="mt-2 w-full rounded-md bg-panel px-3 py-2 text-fg uppercase outline-none placeholder:text-faint placeholder:normal-case focus:ring-2 focus:ring-accent"
      />
      <fieldset className="mt-3">
        <legend className={labelClass}>Cor</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {TAG_COLORS.map((c) => (
            <label key={c} className="relative block size-6 cursor-pointer">
              <input
                type="radio"
                name={`tag-color-${user.id}`}
                value={c}
                checked={color === c}
                onChange={() => setColor(c)}
                aria-label={`Cor ${c}`}
                className="peer absolute inset-0 m-0 cursor-pointer opacity-0"
              />
              <span
                className="block size-6 rounded-full ring-offset-2 ring-offset-rail peer-checked:ring-2 peer-checked:ring-fg peer-focus-visible:ring-2 peer-focus-visible:ring-accent"
                style={{ backgroundColor: c }}
              />
            </label>
          ))}
        </div>
      </fieldset>
      <div className="mt-3 flex items-center gap-2 text-sm text-muted">
        Prévia:
        <span className="font-medium text-fg">{name}</span>
        {normalized && (
          <span className="rounded px-1 text-[10px] font-semibold text-white" style={{ backgroundColor: color }}>
            {normalized}
          </span>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-dnd">
          {error}
        </p>
      )}
      <div className="mt-3 flex items-center gap-2">
        {member.tag && (
          <button
            type="button"
            onClick={() => void save(null)}
            disabled={busy}
            className="rounded-md px-2 py-1.5 text-sm font-medium text-dnd hover:underline disabled:opacity-50"
          >
            Tirar etiqueta
          </button>
        )}
        <button
          type="submit"
          disabled={!normalized || !changed || busy}
          className="ml-auto rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-strong disabled:opacity-50"
        >
          {busy ? 'Salvando…' : 'Salvar'}
        </button>
      </div>
    </form>
  );
}

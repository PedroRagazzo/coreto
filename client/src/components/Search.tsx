import type { Id, Message } from '@shared/models';
import { Permission } from '@shared/permissions';
import type { SearchRequest, SearchScope } from '@shared/protocol';
import { searchWords } from '@shared/search';
import { Hash, ImageIcon, Link2, Paperclip, Search as SearchIcon, X } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { formatMessageTime } from '../lib/format';
import { useRealtime } from '../state/realtime';
import { can, displayNameOf } from '../state/selectors';
import { Avatar } from './Avatar';
import { Markup } from './MessageContent';

/** Caixa de busca do cabeçalho: Enter abre os resultados ao lado. */
export function SearchBox({ placeholder, onSearch }: { placeholder: string; onSearch: (text: string) => void }) {
  const [text, setText] = useState('');
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        onSearch(text.trim());
      }}
      className="relative ml-auto hidden w-56 md:block"
    >
      <input
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full rounded bg-rail py-1 pr-7 pl-2 text-sm placeholder:text-faint focus:ring-1 focus:ring-accent focus:outline-none"
      />
      <SearchIcon size={14} aria-hidden className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-faint" />
    </form>
  );
}

interface SearchPanelProps {
  scope: SearchScope;
  /** Texto vindo da caixa do cabeçalho; mudar refaz a busca. */
  query: string;
  onClose: () => void;
}

const selectClass = 'min-w-0 flex-1 rounded bg-rail px-2 py-1 text-xs text-fg focus:ring-1 focus:ring-accent focus:outline-none';

/**
 * Resultados ao lado da conversa, com filtros de autor, canal, imagem e link.
 * Clicar num resultado abre a conversa já rolada até a mensagem.
 */
export function SearchPanel({ scope, query, onClose }: SearchPanelProps) {
  const { state, actions } = useRealtime();
  const [text, setText] = useState(query);
  const [authorId, setAuthorId] = useState<Id | ''>('');
  const [channelId, setChannelId] = useState<Id | ''>('');
  const [has, setHas] = useState<SearchRequest['has']>();
  const [results, setResults] = useState<{ messages: Message[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(query);

  useEffect(() => {
    setText(query);
    setSubmitted(query);
  }, [query]);

  const inSpace = 'spaceId' in scope;
  const people = inSpace
    ? (state.snapshot?.members.map((m) => m.userId) ?? [])
    : (state.directs[scope.directId]?.participantIds ?? []);
  const channels = inSpace
    ? (state.snapshot?.channels.filter((c) => c.kind === 'text' && can(state.snapshot, c.id, Permission.VIEW_CHANNEL)) ?? [])
    : [];
  const words = searchWords(submitted);

  const request = (before?: Id): SearchRequest => ({
    scope,
    text: submitted,
    ...(authorId && { authorId }),
    ...(channelId && { channelId }),
    ...(has && { has }),
    ...(before && { before }),
  });

  const run = async (before?: Id) => {
    if (!submitted.trim() && !authorId && !channelId && !has) {
      setResults(null);
      setError(null);
      return;
    }
    setLoading(true);
    const res = await actions.search(request(before));
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setError(null);
    setResults((prev) =>
      before && prev ? { total: res.data.total, messages: [...prev.messages, ...res.data.messages] } : res.data,
    );
  };

  // Refaz a busca ao mudar o texto enviado ou um filtro.
  useEffect(() => {
    void run();
  }, [submitted, authorId, channelId, has, inSpace ? scope.spaceId : scope.directId]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(text.trim());
  };

  const toggleHas = (value: NonNullable<SearchRequest['has']>) => setHas((current) => (current === value ? undefined : value));
  const channelName = (id: Id) => state.snapshot?.channels.find((c) => c.id === id)?.name;

  return (
    <aside aria-label="Busca" className="hidden w-[380px] shrink-0 flex-col border-l border-line bg-sidebar lg:flex">
      <div className="space-y-2 border-b border-line p-3">
        <div className="flex items-center gap-2">
          <form onSubmit={submit} className="relative flex-1" role="search">
            <input
              type="search"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Buscar mensagens"
              aria-label="Buscar mensagens"
              autoFocus
              className="w-full rounded bg-rail py-1.5 pr-7 pl-2 text-sm placeholder:text-faint focus:ring-1 focus:ring-accent focus:outline-none"
            />
            <SearchIcon size={14} aria-hidden className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-faint" />
          </form>
          <button type="button" onClick={onClose} aria-label="Fechar busca" className="rounded p-1 text-muted hover:bg-hover hover:text-fg">
            <X size={18} />
          </button>
        </div>

        <div className="flex gap-2">
          <select value={authorId} onChange={(e) => setAuthorId(e.target.value)} aria-label="De quem" className={selectClass}>
            <option value="">De: qualquer pessoa</option>
            {people.map((id) => (
              <option key={id} value={id}>
                De: {displayNameOf(state.snapshot, state.users, id)}
              </option>
            ))}
          </select>
          {inSpace && (
            <select value={channelId} onChange={(e) => setChannelId(e.target.value)} aria-label="Em qual canal" className={selectClass}>
              <option value="">Em: todos os canais</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  Em: #{c.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="flex gap-2">
          <FilterChip active={has === 'image'} onClick={() => toggleHas('image')}>
            <ImageIcon size={13} /> Com imagem
          </FilterChip>
          <FilterChip active={has === 'file'} onClick={() => toggleHas('file')}>
            <Paperclip size={13} /> Com arquivo
          </FilterChip>
          <FilterChip active={has === 'link'} onClick={() => toggleHas('link')}>
            <Link2 size={13} /> Com link
          </FilterChip>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3" aria-live="polite" aria-busy={loading}>
        {error && <p className="text-sm text-dnd">{error}</p>}
        {!error && !results && !loading && (
          <p className="text-sm text-muted">
            Digite palavras (acentos e maiúsculas não importam) ou escolha um filtro.
          </p>
        )}
        {results && (
          <>
            <p className="mb-2 text-xs font-semibold tracking-wide text-faint uppercase">
              {results.total === 0 ? 'Nenhum resultado' : results.total === 1 ? '1 resultado' : `${results.total} resultados`}
            </p>
            <ul className="space-y-2">
              {results.messages.map((message) => (
                <SearchResultItem
                  key={message.id}
                  message={message}
                  words={words}
                  channelName={inSpace ? channelName(message.channelId) : undefined}
                />
              ))}
            </ul>
            {results.messages.length < results.total && (
              <button
                type="button"
                disabled={loading}
                onClick={() => void run(results.messages.at(-1)!.id)}
                className="mt-3 w-full rounded-md bg-elevated py-1.5 text-sm text-muted hover:bg-hover hover:text-fg disabled:opacity-50"
              >
                {loading ? 'Carregando…' : 'Mais resultados'}
              </button>
            )}
          </>
        )}
      </div>
    </aside>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs ${
        active ? 'bg-accent text-white' : 'bg-rail text-muted hover:text-fg'
      }`}
    >
      {children}
    </button>
  );
}

function SearchResultItem({ message, words, channelName }: { message: Message; words: string[]; channelName?: string }) {
  const { state, actions } = useRealtime();
  const [error, setError] = useState<string | null>(null);
  const name = displayNameOf(state.snapshot, state.users, message.authorId);
  const user = state.users[message.authorId];

  return (
    <li>
      <button
        type="button"
        onClick={() => void actions.jumpToMessage(message).then(setError)}
        title="Ir para a mensagem"
        className="w-full rounded-md bg-panel p-2.5 text-left hover:bg-hover/60 focus-visible:outline-2 focus-visible:outline-accent"
      >
        {channelName && (
          <p className="mb-1 flex items-center gap-0.5 text-xs text-faint">
            <Hash size={12} /> {channelName}
          </p>
        )}
        <div className="flex gap-2">
          <Avatar name={name} color={user?.avatarColor ?? '#555'} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="flex items-baseline gap-2">
              <span className="truncate text-sm font-medium">{name}</span>
              <time dateTime={message.createdAt} className="shrink-0 text-[11px] text-faint">
                {formatMessageTime(message.createdAt)}
              </time>
            </p>
            <div className="line-clamp-4 text-sm break-words whitespace-pre-wrap text-fg/90">
              <Markup content={message.content} highlight={words} />
              {message.attachments.length > 0 && (
                <span className="ml-1 inline-flex items-center gap-0.5 text-xs text-faint">
                  <Paperclip size={12} /> {message.attachments.length}
                </span>
              )}
            </div>
          </div>
        </div>
      </button>
      {error && <p className="mt-1 text-xs text-dnd">{error}</p>}
    </li>
  );
}

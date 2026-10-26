import { Permission } from '@shared/permissions';
import { Hash, Pin, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useRealtime } from '../state/realtime';
import { can } from '../state/selectors';
import { MemberList } from './MemberList';
import { MessageInput } from './MessageInput';
import { MessageList } from './MessageList';
import { PinsPanel } from './PinsPanel';
import { SearchBox, SearchPanel } from './Search';
import { TypingIndicator } from './TypingIndicator';

interface ChatPanelProps {
  showMembers: boolean;
  onToggleMembers: () => void;
}

export function ChatPanel({ showMembers, onToggleMembers }: ChatPanelProps) {
  const { state } = useRealtime();
  const { snapshot } = state;
  const channelId = snapshot ? state.activeChannelBySpace[snapshot.space.id] : undefined;
  const channel = snapshot?.channels.find((c) => c.id === channelId);
  /** Texto da busca aberta ao lado; `null` = busca fechada. */
  const [searchQuery, setSearchQuery] = useState<string | null>(null);
  const [showPins, setShowPins] = useState(false);
  const spaceId = snapshot?.space.id;
  useEffect(() => {
    setSearchQuery(null);
    setShowPins(false);
  }, [spaceId]);

  return (
    <>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4 shadow-sm">
        {channel ? (
          <>
            <Hash size={22} className="shrink-0 text-faint" />
            <h2 className="shrink-0 font-semibold">{channel.name}</h2>
            {channel.topic && (
              <>
                <span aria-hidden className="mx-2 h-6 w-px shrink-0 bg-line" />
                <p className="truncate text-sm text-muted">{channel.topic}</p>
              </>
            )}
          </>
        ) : (
          <h2 className="font-semibold text-muted">Nenhum canal selecionado</h2>
        )}
        {snapshot && (
          <SearchBox
            key={snapshot.space.id}
            placeholder={`Buscar em ${snapshot.space.name}`}
            onSearch={(query) => {
              setShowPins(false);
              setSearchQuery(query);
            }}
          />
        )}
        {channel && (
          <button
            type="button"
            onClick={() => {
              setSearchQuery(null);
              setShowPins((open) => !open);
            }}
            aria-pressed={showPins && searchQuery === null}
            aria-label="Mensagens fixadas"
            title="Mensagens fixadas"
            className={`rounded p-1.5 ${showPins && searchQuery === null ? 'text-fg' : 'text-faint hover:text-fg'}`}
          >
            <Pin size={20} />
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setSearchQuery(null);
            setShowPins(false);
            if ((searchQuery === null && !showPins) || !showMembers) onToggleMembers();
          }}
          aria-pressed={showMembers && searchQuery === null && !showPins}
          title={showMembers ? 'Ocultar membros' : 'Mostrar membros'}
          className={`hidden rounded p-1.5 lg:block ${showMembers && searchQuery === null && !showPins ? 'text-fg' : 'text-faint hover:text-fg'}`}
        >
          <Users size={20} />
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <section aria-label="Conversa" className="flex min-w-0 flex-1 flex-col">
          {channel ? (
            <>
              <MessageList
                conversationId={channel.id}
                messages={state.messages[channel.id] ?? []}
                welcome={
                  <>
                    <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-elevated">
                      <Hash size={36} className="text-muted" />
                    </div>
                    <h3 className="text-2xl font-bold">Boas-vindas a #{channel.name}</h3>
                    <p className="text-muted">Este é o começo do canal #{channel.name}.</p>
                  </>
                }
              />
              <MessageInput
                targetId={channel.id}
                label={`#${channel.name}`}
                canSend={can(snapshot, channel.id, Permission.SEND_MESSAGES)}
              />
              <TypingIndicator channelId={channel.id} />
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-8 text-center text-muted">
              {snapshot ? 'Escolha um canal de texto à esquerda.' : 'Carregando…'}
            </div>
          )}
        </section>

        {snapshot && searchQuery !== null ? (
          <SearchPanel scope={{ spaceId: snapshot.space.id }} query={searchQuery} onClose={() => setSearchQuery(null)} />
        ) : showPins && channel ? (
          <PinsPanel channelId={channel.id} canPin={can(snapshot, channel.id, Permission.SEND_MESSAGES)} onClose={() => setShowPins(false)} />
        ) : (
          showMembers && snapshot && <MemberList />
        )}
      </div>
    </>
  );
}

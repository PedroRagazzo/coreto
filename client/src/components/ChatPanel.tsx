import { Permission } from '@shared/permissions';
import { Hash, Users } from 'lucide-react';
import { useRealtime } from '../state/realtime';
import { can } from '../state/selectors';
import { MemberList } from './MemberList';
import { MessageInput } from './MessageInput';
import { MessageList } from './MessageList';
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
        <button
          type="button"
          onClick={onToggleMembers}
          aria-pressed={showMembers}
          title={showMembers ? 'Ocultar membros' : 'Mostrar membros'}
          className={`ml-auto hidden rounded p-1.5 lg:block ${showMembers ? 'text-fg' : 'text-faint hover:text-fg'}`}
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

        {showMembers && snapshot && <MemberList />}
      </div>
    </>
  );
}

import type { DirectConversation, User } from '@shared/models';
import { AtSign, MessageCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useRealtime, type RealtimeState } from '../state/realtime';
import { Avatar, STATUS_LABEL } from './Avatar';
import { MessageInput } from './MessageInput';
import { MessageList } from './MessageList';
import { SearchBox, SearchPanel } from './Search';
import { TypingIndicator } from './TypingIndicator';

function partnerOf(state: RealtimeState, conversation: DirectConversation): User | undefined {
  const [a, b] = conversation.participantIds;
  return state.users[a === state.me?.id ? b : a];
}

/** Mais recentes primeiro; conversas abertas ainda sem mensagens ficam no fim. */
function sortedDirects(state: RealtimeState): DirectConversation[] {
  return Object.values(state.directs).sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''));
}

export function UnreadBadge({ count }: { count: number }) {
  return (
    <span
      aria-label={`${count} não lidas`}
      className="min-w-5 rounded-full bg-dnd px-1.5 text-center text-xs leading-5 font-bold text-white"
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

export function DirectMessagesSidebar() {
  const { state, actions } = useRealtime();
  const conversations = sortedDirects(state);

  return (
    <>
      <header className="flex h-12 shrink-0 items-center border-b border-line px-4 shadow-sm">
        <h1 className="font-semibold">Mensagens diretas</h1>
      </header>
      <nav aria-label="Conversas diretas" className="flex-1 overflow-y-auto px-2 py-3">
        {conversations.length === 0 ? (
          <p className="px-2 text-sm text-muted">
            Nenhuma conversa ainda. Para começar, abra um espaço e clique em alguém na lista de membros.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {conversations.map((conversation) => {
              const partner = partnerOf(state, conversation);
              if (!partner) return null;
              const active = conversation.id === state.activeDirectId;
              const unread = state.unread[conversation.id]?.count ?? 0;
              return (
                <li key={conversation.id}>
                  <button
                    type="button"
                    aria-current={active ? 'page' : undefined}
                    onClick={() => actions.selectDirect(conversation.id)}
                    className={`flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left ${
                      active ? 'bg-hover text-fg' : 'text-muted hover:bg-hover/60 hover:text-fg'
                    }`}
                  >
                    <Avatar name={partner.displayName} color={partner.avatarColor} status={partner.status} size="sm" />
                    <span className={`flex-1 truncate text-[15px] ${unread ? 'font-semibold text-fg' : ''}`}>
                      {partner.displayName}
                    </span>
                    {unread > 0 && <UnreadBadge count={unread} />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </nav>
    </>
  );
}

export function DirectMessagesPanel() {
  const { state } = useRealtime();
  const conversation = state.activeDirectId ? state.directs[state.activeDirectId] : undefined;
  const partner = conversation ? partnerOf(state, conversation) : undefined;
  const [searchQuery, setSearchQuery] = useState<string | null>(null);
  useEffect(() => setSearchQuery(null), [conversation?.id]);

  if (!conversation || !partner) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <MessageCircle size={48} className="text-faint" />
        <h2 className="text-lg font-semibold">Mensagens diretas</h2>
        <p className="max-w-sm text-muted">
          Escolha uma conversa à esquerda ou clique em alguém na lista de membros de um espaço para começar.
        </p>
      </div>
    );
  }

  return (
    <>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4 shadow-sm">
        <AtSign size={20} className="shrink-0 text-faint" />
        <h2 className="truncate font-semibold">{partner.displayName}</h2>
        <span className="shrink-0 text-sm text-muted">· {STATUS_LABEL[partner.status]}</span>
        <SearchBox key={conversation.id} placeholder={`Buscar com ${partner.displayName}`} onSearch={setSearchQuery} />
      </header>
      <div className="flex min-h-0 flex-1">
        <section aria-label={`Conversa com ${partner.displayName}`} className="flex min-w-0 flex-1 flex-col">
          <MessageList
            conversationId={conversation.id}
            messages={state.messages[conversation.id] ?? []}
            welcome={
              <>
                <div className="mb-3">
                  <Avatar name={partner.displayName} color={partner.avatarColor} size="lg" />
                </div>
                <h3 className="text-2xl font-bold">{partner.displayName}</h3>
                <p className="text-muted">Este é o começo da sua conversa direta com {partner.displayName}.</p>
              </>
            }
          />
          <MessageInput targetId={conversation.id} label={`@${partner.displayName}`} canSend />
          <TypingIndicator channelId={conversation.id} />
        </section>
        {searchQuery !== null && (
          <SearchPanel scope={{ directId: conversation.id }} query={searchQuery} onClose={() => setSearchQuery(null)} />
        )}
      </div>
    </>
  );
}

import type { Channel, Id, Message } from '@shared/models';
import { Hash } from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';
import { formatMessageTime, formatShortTime } from '../lib/format';
import { useRealtime } from '../state/realtime';
import { displayNameOf, roleColorOf } from '../state/selectors';
import { Avatar } from './Avatar';

/** Mensagens seguidas do mesmo autor dentro desta janela viram um bloco só. */
const GROUP_WINDOW_MS = 5 * 60_000;

interface MessageGroup {
  authorId: Id;
  items: Message[];
}

function groupMessages(messages: Message[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  for (const message of messages) {
    const last = groups.at(-1);
    const previous = last?.items.at(-1);
    if (
      last &&
      previous &&
      last.authorId === message.authorId &&
      Date.parse(message.createdAt) - Date.parse(previous.createdAt) < GROUP_WINDOW_MS
    ) {
      last.items.push(message);
    } else {
      groups.push({ authorId: message.authorId, items: [message] });
    }
  }
  return groups;
}

export function MessageList({ channel, messages }: { channel: Channel; messages: Message[] }) {
  const { state } = useRealtime();
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  // Trocar de canal sempre leva ao fim; mensagens novas só rolam se você já estava no fim.
  useLayoutEffect(() => {
    stickToBottom.current = true;
  }, [channel.id]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, channel.id]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  return (
    <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto" role="log" aria-live="polite">
      <div className="flex min-h-full flex-col justify-end pb-4">
        <div className="px-4 pt-8 pb-4">
          <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-elevated">
            <Hash size={36} className="text-muted" />
          </div>
          <h3 className="text-2xl font-bold">Boas-vindas a #{channel.name}</h3>
          <p className="text-muted">Este é o começo do canal #{channel.name}.</p>
        </div>

        {groupMessages(messages).map((group) => {
          const author = state.users[group.authorId];
          const name = displayNameOf(state.snapshot, state.users, group.authorId);
          const [first, ...rest] = group.items;
          return (
            <article key={first.id} className="mt-4">
              <div className="group flex gap-4 px-4 py-0.5 hover:bg-rail/30">
                <Avatar name={name} color={author?.avatarColor ?? '#555'} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-baseline gap-2">
                    <span
                      className="font-medium"
                      style={{ color: roleColorOf(state.snapshot, group.authorId) ?? undefined }}
                    >
                      {name}
                    </span>
                    {author?.isBot && (
                      <span className="rounded bg-accent px-1 text-[10px] font-semibold text-white">ROBÔ</span>
                    )}
                    <time dateTime={first.createdAt} className="text-xs text-faint">
                      {formatMessageTime(first.createdAt)}
                    </time>
                  </p>
                  <MessageBody message={first} />
                </div>
              </div>
              {rest.map((message) => (
                <div key={message.id} className="group flex gap-4 px-4 py-0.5 hover:bg-rail/30">
                  <time
                    dateTime={message.createdAt}
                    className="w-10 shrink-0 pt-1 text-right text-[10px] text-faint opacity-0 group-hover:opacity-100"
                  >
                    {formatShortTime(message.createdAt)}
                  </time>
                  <div className="min-w-0 flex-1">
                    <MessageBody message={message} />
                  </div>
                </div>
              ))}
            </article>
          );
        })}
      </div>
    </div>
  );
}

function MessageBody({ message }: { message: Message }) {
  return (
    <p className="text-[15px] leading-relaxed break-words whitespace-pre-wrap text-fg/95">
      {message.content}
      {message.editedAt && <span className="ml-1 text-[10px] text-faint">(editada)</span>}
    </p>
  );
}

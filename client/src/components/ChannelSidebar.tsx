import type { Channel, Id } from '@shared/models';
import { hasPermission, Permission } from '@shared/permissions';
import { ChevronDown, ChevronRight, Hash, HeadphoneOff, Lock, MicOff, Plus, Settings, Volume2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useRealtime } from '../state/realtime';
import { can, displayNameOf, groupChannels } from '../state/selectors';
import { Avatar } from './Avatar';
import { CreateChannelDialog } from './CreateChannelDialog';
import { EditChannelDialog } from './EditChannelDialog';

export function ChannelSidebar() {
  const { state } = useRealtime();
  const [collapsed, setCollapsed] = useState<Record<Id, boolean>>({});
  /** Categoria em que o diálogo de criar canal foi aberto; `null` = fechado. */
  const [creatingIn, setCreatingIn] = useState<{ categoryId: Id | null } | null>(null);
  const [editing, setEditing] = useState<Channel | null>(null);
  const { snapshot } = state;

  if (!snapshot) {
    return (
      <div className="flex-1 animate-pulse space-y-3 p-4" aria-busy="true" aria-label="Carregando canais">
        <div className="h-5 w-32 rounded bg-elevated" />
        <div className="h-4 w-40 rounded bg-elevated" />
        <div className="h-4 w-36 rounded bg-elevated" />
      </div>
    );
  }

  const activeChannelId = state.activeChannelBySpace[snapshot.space.id];
  const canManage = hasPermission(snapshot.spacePermissions, Permission.MANAGE_CHANNELS);

  return (
    <>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4 shadow-sm">
        <h1 className="flex-1 truncate font-semibold">{snapshot.space.name}</h1>
        {canManage && (
          <button
            type="button"
            title="Criar canal"
            aria-label="Criar canal"
            onClick={() => setCreatingIn({ categoryId: null })}
            className="rounded p-1 text-muted hover:bg-hover hover:text-fg"
          >
            <Plus size={18} />
          </button>
        )}
      </header>

      <nav aria-label="Canais" className="flex-1 overflow-y-auto px-2 py-3">
        {groupChannels(snapshot, canManage).map(({ category, channels }) => {
          const isCollapsed = category ? Boolean(collapsed[category.id]) : false;
          // Recolhida, a categoria ainda mostra o canal aberto e a sala de voz em que você está.
          const visible = isCollapsed
            ? channels.filter((c) => c.id === activeChannelId || c.id === state.myVoice.channelId)
            : channels;

          return (
            <section key={category?.id ?? 'sem-categoria'} className="mb-4">
              {category && (
                <div className="group flex items-center pr-1">
                  <button
                    type="button"
                    aria-expanded={!isCollapsed}
                    onClick={() => setCollapsed((prev) => ({ ...prev, [category.id]: !isCollapsed }))}
                    className="flex min-w-0 flex-1 items-center gap-0.5 px-1 text-xs font-semibold tracking-wide text-faint uppercase hover:text-fg"
                  >
                    {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                    <span className="truncate">{category.name}</span>
                  </button>
                  {canManage && (
                    <button
                      type="button"
                      title={`Criar canal em ${category.name}`}
                      aria-label={`Criar canal em ${category.name}`}
                      onClick={() => setCreatingIn({ categoryId: category.id })}
                      className="rounded text-faint opacity-0 group-hover:opacity-100 hover:text-fg focus-visible:opacity-100"
                    >
                      <Plus size={16} />
                    </button>
                  )}
                </div>
              )}
              <ul className="mt-1 space-y-0.5">
                {visible.map((channel) => {
                  const onEdit = canManage ? () => setEditing(channel) : undefined;
                  return channel.kind === 'text' ? (
                    <TextChannelItem
                      key={channel.id}
                      channel={channel}
                      active={channel.id === activeChannelId}
                      onEdit={onEdit}
                    />
                  ) : (
                    <VoiceChannelItem key={channel.id} channel={channel} onEdit={onEdit} />
                  );
                })}
              </ul>
            </section>
          );
        })}
      </nav>

      {creatingIn && (
        <CreateChannelDialog initialCategoryId={creatingIn.categoryId} onClose={() => setCreatingIn(null)} />
      )}
      {editing && <EditChannelDialog channel={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

/** Linha de canal com a engrenagem de edição, que aparece no hover para quem pode gerenciar canais. */
function ChannelRow({ channel, onEdit, children }: { channel: Channel; onEdit?: () => void; children: ReactNode }) {
  return (
    <div className="group/row relative">
      {children}
      {onEdit && (
        <button
          type="button"
          title="Editar canal"
          aria-label={`Editar ${channel.kind === 'text' ? '#' : ''}${channel.name}`}
          onClick={onEdit}
          className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5 text-faint opacity-0 group-hover/row:opacity-100 hover:text-fg focus-visible:opacity-100"
        >
          <Settings size={15} />
        </button>
      )}
    </div>
  );
}

interface ChannelItemProps {
  channel: Channel;
  onEdit?: () => void;
}

function TextChannelItem({ channel, active, onEdit }: ChannelItemProps & { active: boolean }) {
  const { actions } = useRealtime();
  return (
    <li>
      <ChannelRow channel={channel} onEdit={onEdit}>
        <button
          type="button"
          aria-current={active ? 'page' : undefined}
          onClick={() => actions.selectChannel(channel.id)}
          className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-[15px] ${onEdit ? 'pr-7' : ''} ${
            active ? 'bg-hover text-fg' : 'text-muted hover:bg-hover/60 hover:text-fg'
          }`}
        >
          <Hash size={18} className="shrink-0 text-faint" />
          <span className="truncate">{channel.name}</span>
        </button>
      </ChannelRow>
    </li>
  );
}

function VoiceChannelItem({ channel, onEdit }: ChannelItemProps) {
  const { state, actions } = useRealtime();
  const participants = state.voice[channel.id] ?? [];
  const canConnect = can(state.snapshot, channel.id, Permission.CONNECT);
  const isMine = state.myVoice.channelId === channel.id;

  return (
    <li>
      <ChannelRow channel={channel} onEdit={onEdit}>
        <button
          type="button"
          disabled={!canConnect}
          onClick={() => actions.joinVoice(channel.id)}
          title={canConnect ? `Entrar em ${channel.name}` : 'Você não pode entrar neste canal'}
          className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-[15px] disabled:cursor-not-allowed disabled:opacity-60 ${onEdit ? 'pr-7' : ''} ${
            isMine ? 'bg-hover text-fg' : 'text-muted hover:bg-hover/60 hover:text-fg'
          }`}
        >
          {canConnect ? (
            <Volume2 size={18} className="shrink-0 text-faint" />
          ) : (
            <Lock size={16} className="shrink-0 text-faint" />
          )}
          <span className="truncate">{channel.name}</span>
        </button>
      </ChannelRow>

      {participants.length > 0 && (
        <ul aria-label={`Na sala ${channel.name}`} className="mt-0.5 mb-1 ml-7 space-y-0.5">
          {participants.map((p) => {
            const user = state.users[p.userId];
            const name = displayNameOf(state.snapshot, state.users, p.userId);
            return (
              <li key={p.userId} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm text-muted">
                <Avatar name={name} color={user?.avatarColor ?? '#555'} size="xs" />
                <span className="flex-1 truncate">{name}</span>
                {p.deafened ? (
                  <HeadphoneOff size={14} aria-label="Som desativado" className="text-dnd" />
                ) : (
                  p.muted && <MicOff size={14} aria-label="Microfone desativado" className="text-dnd" />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

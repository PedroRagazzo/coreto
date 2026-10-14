// Layout principal em três colunas:
//   1. SpaceRail      — barra fina com os espaços e o atalho de mensagens diretas
//   2. barra lateral  — canais por categoria, chamada de voz ativa e painel do usuário
//   3. painel central — chat do canal, com a lista de membros à direita

import { useState } from 'react';
import { useRealtime } from '../../state/realtime';
import { ChannelSidebar } from '../ChannelSidebar';
import { ChatPanel } from '../ChatPanel';
import { ConnectionBanner } from '../ConnectionBanner';
import { DirectMessagesPanel, DirectMessagesSidebar } from '../DirectMessages';
import { SpaceRail } from '../SpaceRail';
import { UserPanel } from '../UserPanel';
import { VoiceStatusBar } from '../VoiceStatusBar';

export function AppShell() {
  const { state } = useRealtime();
  const [showMembers, setShowMembers] = useState(true);
  const inDirectMessages = state.activeSpaceId === null;

  return (
    <div className="flex h-dvh overflow-hidden bg-panel text-fg">
      {/* Coluna 1: espaços */}
      <SpaceRail />

      {/* Coluna 2: canais */}
      <aside className="flex w-60 shrink-0 flex-col bg-sidebar">
        {inDirectMessages ? <DirectMessagesSidebar /> : <ChannelSidebar />}
        <VoiceStatusBar />
        <UserPanel />
      </aside>

      {/* Coluna 3: conversa + membros */}
      <main className="flex min-w-0 flex-1 flex-col">
        <ConnectionBanner />
        {inDirectMessages ? (
          <DirectMessagesPanel />
        ) : (
          <ChatPanel showMembers={showMembers} onToggleMembers={() => setShowMembers((v) => !v)} />
        )}
      </main>
    </div>
  );
}

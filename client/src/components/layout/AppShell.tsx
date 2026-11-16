// Layout principal em três painéis flutuantes (cantos redondos, com espaço entre eles sobre o fundo azulado):
//   1. SpaceRail      — barra fina com os espaços e o atalho de mensagens diretas
//   2. barra lateral  — canais por categoria, chamada de voz ativa (com os botões) e painel do usuário
//   3. painel central — chat do canal, com a lista de membros à direita

import { useState } from 'react';
import { useRealtime } from '../../state/realtime';
import { ChannelSidebar } from '../ChannelSidebar';
import { ChatPanel } from '../ChatPanel';
import { ConnectionBanner } from '../ConnectionBanner';
import { DirectMessagesPanel, DirectMessagesSidebar } from '../DirectMessages';
import { CallView } from '../CallView';
import { WhatsNew } from '../Changelog';
import { SpaceRail } from '../SpaceRail';
import { StreamStage } from '../StreamStage';
import { UpdateBanner } from '../UpdateBanner';
import { UserPanel } from '../UserPanel';
import { VoiceStatusBar } from '../VoiceStatusBar';
import { CallSounds, Shortcuts } from '../VoiceEffects';

export function AppShell() {
  const { state } = useRealtime();
  const [showMembers, setShowMembers] = useState(true);
  const inDirectMessages = state.activeSpaceId === null;

  return (
    <div className="app-backdrop flex h-dvh gap-3 overflow-hidden p-3 text-fg">
      <CallSounds />
      <Shortcuts />
      <WhatsNew />
      {/* Coluna 1: espaços */}
      <SpaceRail />

      {/* Coluna 2: canais */}
      <aside className="flex w-64 shrink-0 flex-col overflow-hidden rounded-3xl border border-line bg-sidebar/85">
        {inDirectMessages ? <DirectMessagesSidebar /> : <ChannelSidebar />}
        <VoiceStatusBar />
        <UserPanel />
      </aside>

      {/* Coluna 3: conversa + membros */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-3xl border border-line bg-panel/90">
        <UpdateBanner />
        <ConnectionBanner />
        {state.stages.length > 0 ? (
          <StreamStage />
        ) : state.callView && state.myVoice.channelId ? (
          <CallView />
        ) : inDirectMessages ? (
          <DirectMessagesPanel />
        ) : (
          <ChatPanel showMembers={showMembers} onToggleMembers={() => setShowMembers((v) => !v)} />
        )}
      </main>
    </div>
  );
}

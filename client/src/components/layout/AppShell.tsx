// Layout principal em três painéis flutuantes (cantos redondos, com espaço entre eles sobre o fundo azulado):
//   1. SpaceRail      — barra fina com os espaços e o atalho de mensagens diretas
//   2. barra lateral  — canais por categoria, chamada de voz ativa (com os botões) e painel do usuário
//   3. painel central — chat do canal, com a lista de membros à direita

import { useEffect, useRef, useState } from 'react';
import { MobileNavProvider, useMobileNav } from './mobile-nav';
import { PhoneCallBar } from './PhoneCallBar';
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
  return (
    <MobileNavProvider>
      <Shell />
    </MobileNavProvider>
  );
}

function Shell() {
  const { state } = useRealtime();
  const { pane, showContent } = useMobileNav();
  const [showMembers, setShowMembers] = useState(true);
  const inDirectMessages = state.activeSpaceId === null;

  // Abrir a visão da chamada, uma transmissão ou uma conversa direta (por exemplo, tocando num membro) leva à tela cheia no celular.
  // Só quando passam a abrir (não quando fecham nem quando algo muda atrás da lista).
  const opened = state.callView || state.stages.length > 0;
  const seen = useRef({ opened, direct: state.activeDirectId });
  useEffect(() => {
    const before = seen.current;
    seen.current = { opened, direct: state.activeDirectId };
    if ((opened && !before.opened) || (state.activeDirectId && state.activeDirectId !== before.direct)) showContent();
  }, [opened, state.activeDirectId, showContent]);

  return (
    <div className="app-backdrop flex h-dvh overflow-hidden text-fg md:gap-3 md:p-3">
      <CallSounds />
      <Shortcuts />
      <WhatsNew />
      {/* No celular, ou a lista (espaços e canais) ou a conversa: `contents` deixa os filhos como colunas do `flex` de fora. */}
      <div className={pane === 'nav' ? 'contents' : 'hidden md:contents'}>
        {/* Coluna 1: espaços */}
        <SpaceRail />

        {/* Coluna 2: canais */}
        <aside className="flex min-w-0 flex-1 flex-col overflow-hidden border-line bg-sidebar/85 md:w-64 md:flex-none md:rounded-3xl md:border">
          {inDirectMessages ? <DirectMessagesSidebar /> : <ChannelSidebar />}
          <VoiceStatusBar />
          <UserPanel />
        </aside>
      </div>

      {/* Coluna 3: conversa + membros */}
      <main className={`${pane === 'content' ? 'flex' : 'hidden md:flex'} min-w-0 flex-1 flex-col overflow-hidden border-line bg-panel/90 md:rounded-3xl md:border`}>
        <UpdateBanner />
        <ConnectionBanner />
        <PhoneCallBar />
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

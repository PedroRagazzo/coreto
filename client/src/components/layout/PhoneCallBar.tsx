import { Mic, MicOff, PhoneOff } from 'lucide-react';
import { useRealtime } from '../../state/realtime';
import { useMobileNav } from './mobile-nav';

/**
 * No celular, com a conversa (ou a chamada) em tela cheia, os botões da chamada (que ficam na lateral, na tela da lista) não estão
 * à vista: esta barra no topo mostra a chamada em que você está, deixa mutar e sair e, ao tocar no nome, volta à lista.
 */
export function PhoneCallBar() {
  const { state, actions } = useRealtime();
  const { pane, showNav } = useMobileNav();
  const voice = state.myVoice;
  if (!voice.channelId || pane !== 'content') return null;

  return (
    <div role="region" aria-label="Chamada em andamento" className="flex shrink-0 items-center gap-2 border-b border-line bg-rail/60 px-3 py-1.5 md:hidden">
      <button type="button" onClick={showNav} className="min-w-0 flex-1 truncate text-left text-sm font-medium text-online">
        {voice.channelName ?? 'Chamada'}
      </button>
      <button
        type="button"
        onClick={actions.toggleMute}
        aria-label={voice.muted ? 'Ativar microfone' : 'Desativar microfone'}
        className={`rounded p-1.5 ${voice.muted ? 'text-dnd' : 'text-muted hover:text-fg'}`}
      >
        {voice.muted ? <MicOff size={20} /> : <Mic size={20} />}
      </button>
      <button type="button" onClick={actions.leaveVoice} aria-label="Sair da chamada" className="rounded p-1.5 text-dnd">
        <PhoneOff size={20} />
      </button>
    </div>
  );
}

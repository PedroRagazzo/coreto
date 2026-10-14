import { Headphones, HeadphoneOff, Mic, MicOff, PhoneOff, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useRealtime } from '../state/realtime';

/** Faixa acima do painel do usuário enquanto há uma chamada de voz ativa. */
export function VoiceStatusBar() {
  const { state, actions } = useRealtime();
  const voice = state.myVoice;

  if (voice.error) {
    return (
      <div role="alert" className="flex items-start gap-2 border-t border-line bg-rail/40 px-3 py-2">
        <p className="flex-1 text-xs text-dnd">{voice.error}</p>
        <button
          type="button"
          aria-label="Fechar aviso"
          onClick={actions.dismissVoiceError}
          className="text-faint hover:text-fg"
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  if (!voice.channelId && !voice.connecting) return null;

  return (
    <div className="flex items-center gap-1 border-t border-line bg-rail/40 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-semibold ${voice.connecting ? 'text-idle' : 'text-online'}`}>
          {voice.connecting ? 'Conectando…' : 'Voz conectada'}
        </p>
        {voice.channelName && (
          <p className="truncate text-xs text-muted">
            {voice.channelName} / {voice.spaceName}
          </p>
        )}
      </div>
      {voice.channelId && (
        <>
          <VoiceButton
            label={voice.muted ? 'Ativar microfone' : 'Desativar microfone'}
            active={voice.muted}
            disabled={!voice.canSpeak}
            onClick={actions.toggleMute}
          >
            {voice.muted ? <MicOff size={18} /> : <Mic size={18} />}
          </VoiceButton>
          <VoiceButton
            label={voice.deafened ? 'Ativar som' : 'Desativar som'}
            active={voice.deafened}
            onClick={actions.toggleDeafen}
          >
            {voice.deafened ? <HeadphoneOff size={18} /> : <Headphones size={18} />}
          </VoiceButton>
          <VoiceButton label="Sair da chamada" onClick={actions.leaveVoice}>
            <PhoneOff size={18} />
          </VoiceButton>
        </>
      )}
    </div>
  );
}

interface VoiceButtonProps {
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  children: ReactNode;
}

function VoiceButton({ label, onClick, active = false, disabled = false, children }: VoiceButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-md p-1.5 hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40 ${
        active ? 'text-dnd' : 'text-muted hover:text-fg'
      }`}
    >
      {children}
    </button>
  );
}

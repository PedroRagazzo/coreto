import { Eye, Headphones, HeadphoneOff, Mic, MicOff, MonitorUp, MonitorX, Music2, Pause, PhoneOff, Play, Settings2, SkipForward, Video, VideoOff, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useRealtime } from '../state/realtime';
import { MusicDialog, useMusic } from './MusicDialog';
import { ScreenShareDialog } from './ScreenShareDialog';
import { StreamSettingsDialog } from './StreamSettingsDialog';
import { LiveBadge } from './StreamStage';

/** Faixa acima do painel do usuário enquanto há uma chamada de voz ativa. */
export function VoiceStatusBar() {
  const { state, actions } = useRealtime();
  const [choosingScreen, setChoosingScreen] = useState(false);
  const [configuring, setConfiguring] = useState(false);
  const [musicOpen, setMusicOpen] = useState(false);
  const music = useMusic();
  const voice = state.myVoice;
  const me = state.me?.id;
  const viewers = voice.channelId ? (state.voice[voice.channelId] ?? []).filter((p) => me !== undefined && p.watching.includes(me)).length : 0;

  // Um aviso (microfone negado, falha ao compartilhar...) aparece acima da chamada, sem escondê-la.
  const alert = voice.error && (
    <div role="alert" className="flex items-start gap-2 border-t border-line bg-rail/40 px-3 py-2">
      <p className="flex-1 text-xs text-dnd">{voice.error}</p>
      <button type="button" aria-label="Fechar aviso" onClick={actions.dismissVoiceError} className="text-faint hover:text-fg">
        <X size={14} />
      </button>
    </div>
  );

  if (!voice.channelId && !voice.connecting) return alert || null;

  return (
    <>
      {alert}
      <div className="border-t border-line bg-rail/40 px-3 py-2">
        <div className="flex items-center gap-1">
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

        {voice.channelId &&
          (voice.streaming ? (
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => actions.watchStream(me!)}
                title="Ver a prévia da sua tela"
                className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 py-1 text-xs text-muted hover:bg-hover hover:text-fg"
              >
                <LiveBadge />
                <Eye size={14} aria-hidden />
                <span className="truncate">{viewers === 1 ? '1 assistindo' : `${viewers} assistindo`}</span>
              </button>
              <button
                type="button"
                onClick={() => setConfiguring(true)}
                title="Configurações da transmissão"
                aria-label="Configurações da transmissão"
                className="rounded-md p-1.5 text-muted hover:bg-hover hover:text-fg"
              >
                <Settings2 size={18} />
              </button>
              <button
                type="button"
                onClick={actions.stopScreenShare}
                title="Parar de transmitir"
                aria-label="Parar de transmitir"
                className="rounded-md bg-dnd/15 p-1.5 text-dnd hover:bg-dnd/25"
              >
                <MonitorX size={18} />
              </button>
            </div>
          ) : null)}

        {/* O que o bot de música está tocando, com os controles principais; o painel completo abre no botão "Música". */}
        {voice.channelId && music?.state.current && (
          <div className="mt-2 flex items-center gap-1.5 rounded-md bg-elevated/60 px-2 py-1.5">
            <button
              type="button"
              onClick={() => setMusicOpen(true)}
              title="Abrir o painel de música"
              className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs text-muted hover:text-fg"
            >
              <Music2 size={14} className="shrink-0 text-accent" aria-hidden />
              <span className="truncate">{music.state.current.title}</span>
            </button>
            <button
              type="button"
              onClick={() => void actions.musicControl({ action: music.state.paused ? 'resume' : 'pause' })}
              aria-label={music.state.paused ? 'Continuar a música' : 'Pausar a música'}
              title={music.state.paused ? 'Continuar' : 'Pausar'}
              className="rounded p-1 text-muted hover:bg-hover hover:text-fg"
            >
              {music.state.paused ? <Play size={15} /> : <Pause size={15} />}
            </button>
            <button
              type="button"
              onClick={() => void actions.musicControl({ action: 'skip' })}
              aria-label="Pular a música"
              title="Pular"
              className="rounded p-1 text-muted hover:bg-hover hover:text-fg"
            >
              <SkipForward size={15} />
            </button>
          </div>
        )}

        {/* Como no Discord: Câmera e Tela lado a lado. */}
        {voice.channelId && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={!voice.canStream}
              onClick={actions.toggleCamera}
              aria-pressed={voice.video}
              title={voice.canStream ? undefined : 'Você não tem permissão para usar vídeo neste canal'}
              className={`flex items-center justify-center gap-1.5 rounded-md py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
                voice.video ? 'bg-fg text-rail hover:bg-fg/85' : 'bg-elevated text-muted hover:bg-hover hover:text-fg'
              }`}
            >
              {voice.video ? <Video size={16} /> : <VideoOff size={16} />}
              Câmera
            </button>
            <button
              type="button"
              disabled={!voice.canStream || voice.streaming}
              onClick={() => setChoosingScreen(true)}
              title={voice.canStream ? undefined : 'Você não tem permissão para usar vídeo neste canal'}
              className="flex items-center justify-center gap-1.5 rounded-md bg-elevated py-1.5 text-sm font-medium text-muted hover:bg-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
            >
              <MonitorUp size={16} />
              Tela
            </button>
            <button
              type="button"
              onClick={() => setMusicOpen(true)}
              className="col-span-2 flex items-center justify-center gap-1.5 rounded-md bg-elevated py-1.5 text-sm font-medium text-muted hover:bg-hover hover:text-fg"
            >
              <Music2 size={16} />
              Música
            </button>
          </div>
        )}
      </div>
      {choosingScreen && <ScreenShareDialog onClose={() => setChoosingScreen(false)} />}
      {configuring && voice.streaming && <StreamSettingsDialog onClose={() => setConfiguring(false)} />}
      {musicOpen && voice.channelId && <MusicDialog onClose={() => setMusicOpen(false)} />}
    </>
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

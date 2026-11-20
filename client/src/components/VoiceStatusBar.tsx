import { AudioLines, Eye, Headphones, HeadphoneOff, Mic, MicOff, MonitorUp, MonitorX, Music2, Pause, PhoneOff, Play, Replace, SkipForward, Video, VideoOff, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRealtime } from '../state/realtime';
import { MusicDialog, skipText, useMusic } from './MusicDialog';
import { SoundboardDialog } from './SoundboardDialog';
import { loadScreenOptions } from './ScreenQualityFields';
import { ScreenShareDialog } from './ScreenShareDialog';
import { LiveBadge } from './StreamStage';

/** Faixa acima do painel do usuário enquanto há uma chamada de voz ativa. */
export function VoiceStatusBar() {
  const { state, actions } = useRealtime();
  const [choosingScreen, setChoosingScreen] = useState(false);
  const [musicOpen, setMusicOpen] = useState(false);
  const [soundsOpen, setSoundsOpen] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const music = useMusic();
  const voice = state.myVoice;
  const me = state.me?.id;
  // No app de desktop, depois de uma queda o app pede (com o "gesto" que o navegador exige) para a transmissão voltar sozinha, com
  // a mesma tela ou janela e as mesmas escolhas de qualidade. Se não der, o aviso com o botão "Retomar transmissão" fica.
  const resumable = useRef({ ready: false, start: () => Promise.resolve<string | null>(null) });
  resumable.current = {
    ready: Boolean(voice.channelId && voice.resumeScreen && voice.canStream && !voice.streaming),
    start: () => actions.startScreenShare(loadScreenOptions()),
  };
  useEffect(() => {
    const onResume = () => {
      if (resumable.current.ready) void resumable.current.start().then((error) => setResumeError(error || null));
    };
    window.addEventListener('coreto:resume-screen', onResume);
    return () => window.removeEventListener('coreto:resume-screen', onResume);
  }, []);
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
      <div className="border-t border-line px-3 py-3">
        <div className="min-w-0">
          <p className={`text-sm font-semibold ${voice.connecting ? 'text-idle' : 'text-online'}`}>
            {voice.connecting ? 'Conectando…' : 'Voz conectada'}
          </p>
          {voice.channelName && (
            <p className="truncate text-xs text-muted">
              {voice.channelName} / {voice.spaceName}
            </p>
          )}
        </div>

        {/* A conexão caiu com você transmitindo: a chamada voltou sozinha, mas escolher a tela de novo precisa de um clique. */}
        {voice.channelId && voice.resumeScreen && voice.canStream && !voice.streaming && (
          <div className="mt-2 rounded-lg bg-rail/60 p-2">
            <p className="text-xs text-muted">Sua transmissão caiu junto com a conexão.</p>
            {resumeError && (
              <p role="alert" className="mt-1 text-xs text-dnd">
                {resumeError}
              </p>
            )}
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={async () => setResumeError((await actions.startScreenShare(loadScreenOptions())) || null)}
                className="flex-1 rounded-md bg-accent px-2 py-1.5 text-xs font-semibold text-white hover:bg-accent-strong"
              >
                Retomar transmissão
              </button>
              <button type="button" onClick={actions.dismissResumeScreen} className="rounded-md px-2 py-1.5 text-xs text-muted hover:text-fg">
                Agora não
              </button>
            </div>
          </div>
        )}

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
                onClick={() => void actions.switchScreenShare()}
                title="Trocar a janela ou tela transmitida"
                aria-label="Trocar a janela ou tela transmitida"
                className="rounded-md p-1.5 text-muted hover:bg-hover hover:text-fg"
              >
                <Replace size={18} />
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
          <div className="mt-2 flex items-center gap-2 rounded-2xl bg-gradient-to-br from-deep to-accent p-2.5">
            <button
              type="button"
              onClick={() => setMusicOpen(true)}
              title="Abrir o painel de música"
              className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-medium text-white"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-black/35">
                <Music2 size={16} aria-hidden />
              </span>
              <span className="truncate">{music.state.current.title}</span>
            </button>
            <button
              type="button"
              onClick={() => void actions.musicControl({ action: music.state.paused ? 'resume' : 'pause' })}
              aria-label={music.state.paused ? 'Continuar a música' : 'Pausar a música'}
              title={music.state.paused ? 'Continuar' : 'Pausar'}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-deep hover:bg-white/85"
            >
              {music.state.paused ? <Play size={14} /> : <Pause size={14} />}
            </button>
            <button
              type="button"
              onClick={() => void actions.musicControl({ action: 'skip' })}
              aria-label="Pular a música"
              title={skipText(music.state).label}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white hover:bg-white/15"
            >
              <SkipForward size={15} />
            </button>
          </div>
        )}

        {/* Os botões da chamada ficam logo acima do seu nome: quatro redondos e, embaixo, Música, Sons e Sair. */}
        {voice.channelId && (
          <div className="mt-2 flex flex-col gap-2">
            <div className="flex gap-2">
              <RoundButton
                label={voice.muted ? 'Ativar microfone' : 'Desativar microfone'}
                active={voice.muted}
                warning
                disabled={!voice.canSpeak}
                onClick={actions.toggleMute}
              >
                {voice.muted ? <MicOff size={20} /> : <Mic size={20} />}
              </RoundButton>
              <RoundButton
                label={voice.deafened ? 'Ativar som' : 'Desativar som'}
                active={voice.deafened}
                warning
                onClick={actions.toggleDeafen}
              >
                {voice.deafened ? <HeadphoneOff size={20} /> : <Headphones size={20} />}
              </RoundButton>
              <RoundButton
                label="Câmera"
                tooltip={voice.canStream ? (voice.video ? 'Desligar a câmera' : 'Ligar a câmera') : 'Você não tem permissão para usar vídeo neste canal'}
                active={voice.video}
                disabled={!voice.canStream}
                onClick={actions.toggleCamera}
              >
                {voice.video ? <Video size={20} /> : <VideoOff size={20} />}
              </RoundButton>
              <RoundButton
                label="Tela"
                toggle={false}
                tooltip={voice.canStream ? 'Compartilhar a tela' : 'Você não tem permissão para usar vídeo neste canal'}
                disabled={!voice.canStream || voice.streaming}
                onClick={() => setChoosingScreen(true)}
              >
                <MonitorUp size={20} />
              </RoundButton>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMusicOpen(true)}
                className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-full bg-accent text-sm font-semibold text-white hover:bg-accent-strong"
              >
                <Music2 size={16} aria-hidden />
                Música
              </button>
              <button
                type="button"
                onClick={() => setSoundsOpen(true)}
                aria-label="Quadro de som"
                title="Quadro de som"
                className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-full bg-deep text-sm font-semibold text-white hover:bg-deep/80"
              >
                <AudioLines size={16} aria-hidden />
                Sons
              </button>
              <button
                type="button"
                onClick={actions.leaveVoice}
                aria-label="Sair da chamada"
                title="Sair da chamada"
                className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-full border border-fg text-sm font-semibold text-fg hover:bg-fg/10"
              >
                <PhoneOff size={16} aria-hidden />
                Sair
              </button>
            </div>
          </div>
        )}
      </div>
      {choosingScreen && <ScreenShareDialog onClose={() => setChoosingScreen(false)} />}
      {musicOpen && voice.channelId && <MusicDialog onClose={() => setMusicOpen(false)} />}
      {soundsOpen && voice.channelId && <SoundboardDialog onClose={() => setSoundsOpen(false)} />}
    </>
  );
}

interface RoundButtonProps {
  label: string;
  /** O que aparece ao passar o mouse, se for diferente do nome do botão. */
  tooltip?: string;
  onClick: () => void;
  /** Ligado (câmera ligada) ou, com `warning`, desativado (microfone mudo, som desativado). */
  active?: boolean;
  warning?: boolean;
  /** É um botão de liga e desliga (anuncia o estado); a tela abre uma janela, então não. */
  toggle?: boolean;
  disabled?: boolean;
  children: ReactNode;
}

/** Botão redondo da chamada: microfone, som, câmera e tela. */
function RoundButton({ label, tooltip, onClick, active = false, warning = false, toggle = true, disabled = false, children }: RoundButtonProps) {
  return (
    <button
      type="button"
      title={tooltip ?? label}
      aria-label={label}
      aria-pressed={toggle ? active : undefined}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-11 flex-1 items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-40 ${
        active ? (warning ? 'bg-dnd text-white hover:bg-dnd/85' : 'bg-fg text-rail hover:bg-fg/85') : 'bg-elevated text-fg hover:bg-hover'
      }`}
    >
      {children}
    </button>
  );
}

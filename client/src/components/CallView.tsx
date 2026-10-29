import { bestGrid } from '@shared/grid';
import type { Id, VoiceParticipant } from '@shared/models';
import { AudioLines, HeadphoneOff, Mic, MicOff, MonitorUp, Music2, PhoneOff, Settings2, Video, VideoOff, Volume2, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useElementSize } from '../lib/useElementSize';
import { useRealtime } from '../state/realtime';
import { displayNameOf } from '../state/selectors';
import { Avatar } from './Avatar';
import { MusicDialog, useMusic } from './MusicDialog';
import { SoundboardDialog } from './SoundboardDialog';
import { ScreenShareDialog } from './ScreenShareDialog';
import { ConnectionIndicator } from './ConnectionIndicator';
import { StreamSettingsDialog } from './StreamSettingsDialog';
import { LiveBadge } from './StreamStage';
import { useUserVolumeMenu } from './UserVolumeMenu';

/** Espaço entre os quadros (`gap-3`) e o menor quadro aceitável antes de o mosaico passar a rolar, em pixels. */
const TILE_GAP = 12;
const MIN_TILE_WIDTH = 220;

/**
 * Mosaico da chamada, como a visão de canal de voz do Discord: um quadro por
 * pessoa (câmera ou avatar, com o anel de quem fala) e um cartão para cada
 * transmissão de tela, que abre no palco ao clicar.
 */
export function CallView() {
  const { state, actions } = useRealtime();
  const [choosingScreen, setChoosingScreen] = useState(false);
  const [configuring, setConfiguring] = useState(false);
  const [musicOpen, setMusicOpen] = useState(false);
  const [soundsOpen, setSoundsOpen] = useState(false);
  const music = useMusic();
  const voice = state.myVoice;
  const room = voice.channelId ? (state.voice[voice.channelId] ?? []) : [];
  const me = state.me?.id;
  const tiles = room.length + room.filter((p) => p.streaming).length;
  // Colunas para os quadros ficarem o maior possível no espaço que sobra (janela larga ou monitor em pé). Antes de
  // medir, e se o navegador não medir, vale uma regra pelo número de quadros.
  const areaRef = useRef<HTMLDivElement>(null);
  const area = useElementSize(areaRef);
  const plan = area ? bestGrid({ ...area, count: tiles, gap: TILE_GAP, minTileWidth: MIN_TILE_WIDTH }) : null;
  const fallbackColumns = tiles <= 1 ? 'grid-cols-1' : tiles <= 4 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-2 xl:grid-cols-3';

  return (
    <>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4 shadow-sm">
        <Volume2 size={20} className="shrink-0 text-faint" />
        <h2 className="truncate font-semibold">{voice.channelName ?? 'Chamada'}</h2>
        <span className="text-sm text-muted">{room.length === 1 ? '1 pessoa' : `${room.length} pessoas`}</span>
        <button
          type="button"
          onClick={actions.closeCall}
          title="Voltar ao chat (você continua na chamada)"
          aria-label="Fechar a visão da chamada"
          className="ml-auto rounded p-1.5 text-muted hover:bg-hover hover:text-fg"
        >
          <X size={18} />
        </button>
      </header>

      <div ref={areaRef} className="min-h-0 flex-1 overflow-y-auto bg-rail p-4">
        <ul
          className={`grid gap-3 ${plan ? 'min-h-full' : fallbackColumns}`}
          // Colunas de largura exata: os quadros ficam no maior tamanho que cabe e o conjunto fica centralizado.
          style={
            plan
              ? { gridTemplateColumns: `repeat(${plan.columns}, ${plan.tileWidth}px)`, justifyContent: 'center', alignContent: plan.scrolls ? 'start' : 'center' }
              : undefined
          }
          aria-label="Pessoas na chamada"
        >
          {room.map((p) => (
            <ParticipantTile key={p.userId} participant={p} isMe={p.userId === me} />
          ))}
          {room
            .filter((p) => p.streaming)
            .map((p) => (
              <StreamCard key={`tela-${p.userId}`} participant={p} isMe={p.userId === me} />
            ))}
        </ul>
      </div>

      <footer className="flex shrink-0 items-center justify-center gap-3 border-t border-line bg-sidebar py-3">
        <CallButton
          label={voice.video ? 'Desligar câmera' : 'Ligar câmera'}
          active={voice.video}
          disabled={!voice.canStream}
          onClick={actions.toggleCamera}
        >
          {voice.video ? <Video size={20} /> : <VideoOff size={20} />}
        </CallButton>
        <CallButton
          label={voice.streaming ? 'Parar de transmitir' : 'Compartilhar tela'}
          active={voice.streaming}
          disabled={!voice.canStream}
          onClick={voice.streaming ? actions.stopScreenShare : () => setChoosingScreen(true)}
        >
          <MonitorUp size={20} />
        </CallButton>
        {voice.streaming && (
          <CallButton label="Configurações da transmissão" onClick={() => setConfiguring(true)}>
            <Settings2 size={20} />
          </CallButton>
        )}
        <CallButton label="Música" active={Boolean(music?.state.current)} onClick={() => setMusicOpen(true)}>
          <Music2 size={20} />
        </CallButton>
        <CallButton label="Quadro de som" onClick={() => setSoundsOpen(true)}>
          <AudioLines size={20} />
        </CallButton>
        <CallButton
          label={voice.muted ? 'Ativar microfone' : 'Desativar microfone'}
          danger={voice.muted}
          disabled={!voice.canSpeak}
          onClick={actions.toggleMute}
        >
          {voice.muted ? <MicOff size={20} /> : <Mic size={20} />}
        </CallButton>
        <CallButton label="Sair da chamada" danger onClick={actions.leaveVoice}>
          <PhoneOff size={20} />
        </CallButton>
      </footer>
      {choosingScreen && <ScreenShareDialog onClose={() => setChoosingScreen(false)} />}
      {configuring && voice.streaming && <StreamSettingsDialog onClose={() => setConfiguring(false)} />}
      {musicOpen && <MusicDialog onClose={() => setMusicOpen(false)} />}
      {soundsOpen && <SoundboardDialog onClose={() => setSoundsOpen(false)} />}
    </>
  );
}

function useVideo(stream: MediaStream | null) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.srcObject = stream;
    if (stream) video.play().catch(() => {});
  }, [stream]);
  return ref;
}

function ParticipantTile({ participant, isMe }: { participant: VoiceParticipant; isMe: boolean }) {
  const { state } = useRealtime();
  const { userId } = participant;
  const name = displayNameOf(state.snapshot, state.users, userId);
  const user = state.users[userId];
  const stream = participant.video ? (isMe ? state.myCamera : (state.cameras[userId] ?? null)) : null;
  const ref = useVideo(stream);
  const speaking = Boolean(state.speaking[userId]) && !participant.muted;
  const quality = state.quality[userId];
  const volumeMenu = useUserVolumeMenu();

  return (
    <li
      // Botão direito em alguém: volume só seu.
      onContextMenu={isMe ? undefined : (e) => volumeMenu.open(e, userId, name)}
      className={`relative flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-panel ring-2 transition-shadow ${
        speaking ? 'ring-online' : 'ring-transparent'
      }`}
    >
      {stream ? (
        <video
          ref={ref}
          autoPlay
          playsInline
          muted // o som vem pelo áudio da chamada, não pelo vídeo
          aria-label={`Câmera de ${name}`}
          // Sua própria câmera aparece espelhada, como num espelho.
          className={`h-full w-full object-cover ${isMe ? '-scale-x-100' : ''}`}
        />
      ) : (
        <Avatar name={name} color={user?.avatarColor ?? '#555'} size="lg" speaking={speaking} />
      )}
      <span className="absolute bottom-2 left-2 flex max-w-[calc(100%-1rem)] items-center gap-1.5 rounded bg-black/60 px-2 py-0.5 text-sm text-white">
        {participant.deafened ? (
          <HeadphoneOff size={14} aria-label="Som desativado" className="shrink-0 text-dnd" />
        ) : (
          participant.muted && <MicOff size={14} aria-label="Microfone desativado" className="shrink-0 text-dnd" />
        )}
        <span className="truncate">{isMe ? `${name} (você)` : name}</span>
        {speaking && <span className="sr-only">(falando)</span>}
        {quality && <ConnectionIndicator quality={quality} own={isMe} />}
      </span>
      {volumeMenu.menu}
    </li>
  );
}

function StreamCard({ participant, isMe }: { participant: VoiceParticipant; isMe: boolean }) {
  const { state, actions } = useRealtime();
  const name = displayNameOf(state.snapshot, state.users, participant.userId);
  const room = state.myVoice.channelId ? (state.voice[state.myVoice.channelId] ?? []) : [];
  const viewers = room.filter((p: VoiceParticipant) => p.watching.includes(participant.userId)).length;
  return (
    <li className="relative flex aspect-video flex-col items-center justify-center gap-3 rounded-lg bg-panel p-4 text-center">
      <span className="absolute top-2 left-2">
        <LiveBadge />
      </span>
      <MonitorUp size={36} className="text-faint" />
      <p className="font-semibold">{isMe ? 'Sua tela' : `Tela de ${name}`}</p>
      <p className="text-xs text-muted">{viewers === 1 ? '1 assistindo' : `${viewers} assistindo`}</p>
      <button
        type="button"
        onClick={() => actions.watchStream(participant.userId as Id)}
        className="rounded-md bg-accent px-4 py-1.5 text-sm font-semibold text-white hover:bg-accent-strong"
      >
        {isMe ? 'Ver prévia' : 'Assistir'}
      </button>
    </li>
  );
}

interface CallButtonProps {
  label: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  children: ReactNode;
}

function CallButton({ label, onClick, active = false, danger = false, disabled = false, children }: CallButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active || danger}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-11 w-11 items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-40 ${
        danger
          ? 'bg-dnd text-white hover:bg-dnd/85'
          : active
            ? 'bg-fg text-rail hover:bg-fg/85'
            : 'bg-elevated text-fg hover:bg-hover'
      }`}
    >
      {children}
    </button>
  );
}

import type { Id, VoiceParticipant } from '@shared/models';
import { Eye, Maximize, Minimize, Monitor, MonitorOff, Volume2, VolumeX, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useRealtime } from '../state/realtime';
import { displayNameOf } from '../state/selectors';

/** Selo vermelho "AO VIVO" de quem está transmitindo. */
export function LiveBadge() {
  return (
    <span className="shrink-0 rounded bg-dnd px-1 text-[10px] leading-4 font-bold tracking-wide text-white">AO VIVO</span>
  );
}

/** Lista da sala em que a pessoa está, com a entrada dela. */
function findParticipant(voice: Record<Id, VoiceParticipant[]>, userId: Id) {
  for (const room of Object.values(voice)) {
    const self = room.find((p) => p.userId === userId);
    if (self) return { self, room };
  }
  return null;
}

/**
 * Painel central com a transmissão aberta: a sua (prévia) ou a de quem você
 * assiste. Mostra quem está assistindo, volume do som da tela e tela cheia.
 */
export function StreamStage() {
  const { state, actions } = useRealtime();
  const userId = state.stage!;
  const isMe = userId === state.me?.id;
  const found = findParticipant(state.voice, userId);
  const live = isMe ? state.myVoice.streaming : Boolean(found?.self.streaming);
  const stream = isMe ? state.myScreen : (state.screens[userId] ?? null);
  const viewers = (found?.room ?? []).filter((p) => p.watching === userId);
  const name = isMe ? 'Sua tela' : `Tela de ${displayNameOf(state.snapshot, state.users, userId)}`;

  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [volume, setVolume] = useState(1);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [hasAudio, setHasAudio] = useState(false);

  // O som da tela pode chegar depois do vídeo, no mesmo fluxo.
  useEffect(() => {
    if (!stream) return setHasAudio(false);
    const update = () => setHasAudio(stream.getAudioTracks().length > 0);
    update();
    stream.addEventListener('addtrack', update);
    stream.addEventListener('removetrack', update);
    return () => {
      stream.removeEventListener('addtrack', update);
      stream.removeEventListener('removetrack', update);
    };
  }, [stream]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = live ? stream : null;
    if (stream && live) video.play().catch(() => {});
  }, [stream, live]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = volume;
  }, [volume]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stageRef.current?.requestFullscreen();
  };

  const viewerNames = viewers.map((v) => displayNameOf(state.snapshot, state.users, v.userId)).join(', ');

  return (
    <>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4 shadow-sm">
        <Monitor size={20} className="shrink-0 text-faint" />
        <h2 className="truncate font-semibold">{name}</h2>
        {live && <LiveBadge />}
        {live && (
          <span
            className="flex shrink-0 items-center gap-1 text-sm text-muted"
            title={viewers.length ? `Assistindo: ${viewerNames}` : 'Ninguém assistindo ainda'}
          >
            <Eye size={16} aria-hidden />
            <span className="sr-only">Assistindo:</span>
            {viewers.length}
          </span>
        )}
        {size && live && (
          <span className="hidden text-xs text-faint sm:inline">
            {size.width}×{size.height}
          </span>
        )}
        <button
          type="button"
          onClick={actions.closeStage}
          title={isMe ? 'Fechar prévia (a transmissão continua)' : 'Parar de assistir'}
          aria-label={isMe ? 'Fechar prévia' : 'Parar de assistir'}
          className="ml-auto rounded p-1.5 text-muted hover:bg-hover hover:text-fg"
        >
          <X size={18} />
        </button>
      </header>

      <div ref={stageRef} className="group relative flex min-h-0 flex-1 items-center justify-center bg-black">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          // A prévia nunca toca som (eco); quem está com o som desativado não ouve a tela.
          muted={isMe || state.myVoice.deafened}
          aria-label={name}
          onResize={(e) => setSize({ width: e.currentTarget.videoWidth, height: e.currentTarget.videoHeight })}
          className={`h-full w-full object-contain ${live && stream ? '' : 'hidden'}`}
        />

        {!live && (
          <div className="flex flex-col items-center gap-3 p-6 text-center">
            <MonitorOff size={40} className="text-faint" />
            <p className="text-lg font-semibold">{isMe ? 'Você parou de transmitir.' : 'A transmissão terminou.'}</p>
            <button
              type="button"
              onClick={actions.closeStage}
              className="rounded-md bg-elevated px-4 py-2 text-sm font-medium hover:bg-hover"
            >
              Fechar
            </button>
          </div>
        )}
        {live && !stream && (
          <p className="animate-pulse text-muted" role="status">
            Conectando à transmissão…
          </p>
        )}

        {live && stream && (
          <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 bg-gradient-to-t from-black/80 to-transparent px-4 pt-10 pb-3 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            {isMe && (
              <button
                type="button"
                onClick={actions.stopScreenShare}
                className="rounded-md bg-dnd px-3 py-1.5 text-sm font-semibold text-white hover:bg-dnd/85"
              >
                Parar de transmitir
              </button>
            )}
            {!isMe && hasAudio && (
              <label className="flex items-center gap-2 text-white">
                <button
                  type="button"
                  onClick={() => setVolume((v) => (v > 0 ? 0 : 1))}
                  aria-label={volume > 0 ? 'Silenciar a transmissão' : 'Ativar o som da transmissão'}
                  className="rounded p-1 hover:bg-white/10"
                >
                  {volume > 0 && !state.myVoice.deafened ? <Volume2 size={18} /> : <VolumeX size={18} />}
                </button>
                <span className="sr-only">Volume da transmissão</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={volume}
                  onChange={(e) => setVolume(Number(e.target.value))}
                  className="w-28 accent-accent"
                />
              </label>
            )}
            <button
              type="button"
              onClick={toggleFullscreen}
              aria-label={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
              title={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
              className="ml-auto rounded p-1.5 text-white hover:bg-white/10"
            >
              {fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
            </button>
          </div>
        )}
      </div>
    </>
  );
}

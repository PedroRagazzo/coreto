import type { Id, VoiceParticipant } from '@shared/models';
import { Activity, Eye, Maximize, Minimize, Monitor, MonitorOff, Settings2, Volume2, VolumeX, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { StreamStats } from '../lib/voice';
import { useRealtime } from '../state/realtime';
import { displayNameOf } from '../state/selectors';
import { StreamSettingsDialog } from './StreamSettingsDialog';

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
  const [showStats, setShowStats] = useState(false);
  const [configuring, setConfiguring] = useState(false);
  const stats = useStreamStats(userId, showStats && live, actions.screenStats);

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
        {live && isMe && (
          <button
            type="button"
            onClick={() => setConfiguring(true)}
            title="Configurações da transmissão"
            aria-label="Configurações da transmissão"
            className="ml-auto rounded p-1.5 text-muted hover:bg-hover hover:text-fg"
          >
            <Settings2 size={18} />
          </button>
        )}
        {live && (
          <button
            type="button"
            onClick={() => setShowStats((v) => !v)}
            aria-pressed={showStats}
            title="Estatísticas da transmissão"
            aria-label="Estatísticas da transmissão"
            className={`${isMe ? '' : 'ml-auto'} rounded p-1.5 hover:bg-hover ${showStats ? 'text-accent' : 'text-muted hover:text-fg'}`}
          >
            <Activity size={18} />
          </button>
        )}
        <button
          type="button"
          onClick={actions.closeStage}
          title={isMe ? 'Fechar prévia (a transmissão continua)' : 'Parar de assistir'}
          aria-label={isMe ? 'Fechar prévia' : 'Parar de assistir'}
          className={`rounded p-1.5 text-muted hover:bg-hover hover:text-fg ${live ? '' : 'ml-auto'}`}
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

        {showStats && live && <StatsPanel stats={stats} />}

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
      {configuring && live && <StreamSettingsDialog onClose={() => setConfiguring(false)} />}
    </>
  );
}

/** Lê as estatísticas da transmissão a cada segundo enquanto `enabled`. */
function useStreamStats(userId: Id, enabled: boolean, read: (userId: Id) => Promise<StreamStats | null>): StreamStats | null {
  const [stats, setStats] = useState<StreamStats | null>(null);
  const readRef = useRef(read);
  readRef.current = read;
  useEffect(() => {
    if (!enabled) return setStats(null);
    let stopped = false;
    const tick = () => void readRef.current(userId).then((s) => !stopped && setStats(s));
    tick();
    const timer = setInterval(tick, 1_000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [userId, enabled]);
  return stats;
}

const mbps = (kbps: number) => `${(kbps / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} Mb/s`;

/** O que fazer, em palavras, a partir dos números. */
function advice(stats: StreamStats): string | null {
  if (stats.role === 'sending') {
    if (stats.limit === 'cpu') return 'Seu computador está no limite: escolha uma resolução menor ou menos quadros por segundo.';
    if (stats.limit === 'bandwidth') {
      return stats.via === 'sfu'
        ? 'A sua internet de envio está no limite: a imagem é reduzida para caber. Escolha uma resolução menor ou menos quadros por segundo.'
        : 'A sua internet de envio está no limite: a imagem é reduzida para caber. Menos gente assistindo melhora.';
    }
    if (stats.lossPercent > 3) return 'Há perda de pacotes no caminho até quem assiste.';
    return null;
  }
  if (stats.lossPercent > 3) return 'Perda alta de pacotes: a internet de quem transmite ou a sua está instável.';
  return null;
}

function StatsPanel({ stats }: { stats: StreamStats | null }) {
  const tip = stats ? advice(stats) : null;
  return (
    <div
      role="status"
      aria-label="Estatísticas da transmissão"
      className="pointer-events-none absolute top-3 left-3 max-w-sm rounded-md bg-black/75 px-3 py-2 text-xs leading-5 text-white"
    >
      {!stats || (stats.role === 'sending' && stats.viewers === 0) ? (
        <p>{stats?.role === 'sending' ? 'Ninguém assistindo ainda.' : 'Medindo…'}</p>
      ) : (
        <>
          <p className="font-semibold">
            {stats.role === 'sending' ? `Enviando para ${stats.viewers} ${stats.viewers === 1 ? 'pessoa' : 'pessoas'}` : 'Recebendo'}
            {stats.via === 'sfu' ? ' · servidor de mídia' : ' · direto (P2P)'}
          </p>
          <p>
            {stats.width && stats.height ? `${stats.width}×${stats.height}` : '—'} · {Math.round(stats.fps)} fps · {mbps(stats.kbps)}
            {stats.role === 'sending' && stats.via === 'p2p' && stats.viewers > 1 ? ' no total' : ''}
          </p>
          <p>
            {stats.codec ? `${stats.codec} · ` : ''}perda {stats.lossPercent.toFixed(1)}%
            {stats.rttMs !== null ? ` · ${Math.round(stats.rttMs)} ms` : ''}
          </p>
          {tip && <p className="mt-1 text-idle">{tip}</p>}
        </>
      )}
    </div>
  );
}

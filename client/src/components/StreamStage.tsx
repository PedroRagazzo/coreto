import { bestGrid } from '@shared/grid';
import type { Id, VoiceParticipant } from '@shared/models';
import { diagnoseStream, type StreamAdvice } from '@shared/stream-quality';
import {
  Activity,
  Eye,
  LayoutGrid,
  Maximize,
  Maximize2,
  Minimize,
  Monitor,
  MonitorOff,
  PanelRight,
  Replace,
  Settings2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useElementSize } from '../lib/useElementSize';
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

/** Largura da coluna das transmissões pequenas, no modo com uma em destaque. */
const SIDE_COLUMN = '16rem';
/** Altura da fileira das transmissões pequenas quando a janela é mais alta que larga. */
const STACKED_STRIP = '9rem';
/** Espaço entre as transmissões (`gap-1`) e altura do cabeçalho de cada uma (`h-10`), em pixels, para a conta do arranjo. */
const GAP = 4;
const TILE_HEADER = 40;

/**
 * Como cada transmissão ocupa o painel. As telas ficam sempre na mesma ordem no mesmo contêiner (só muda o
 * lugar na grade), então trocar a que está em destaque não recria os vídeos nem tira ninguém da tela cheia.
 */
function placement(layout: 'focus' | 'grid', count: number, isFocus: boolean, order: number, stacked: boolean): CSSProperties {
  if (count === 1) return { gridColumn: 1, gridRow: 1 };
  if (layout === 'grid') return {};
  // Janela em pé: a grande ocupa a largura toda em cima; as pequenas ficam lado a lado numa fileira embaixo.
  if (stacked) return isFocus ? { gridColumn: `1 / span ${count - 1}`, gridRow: 1 } : { gridColumn: order + 1, gridRow: 2 };
  // Em destaque: a grande ocupa toda a altura à esquerda; as pequenas empilham à direita, na ordem em que abriram.
  return isFocus ? { gridColumn: 1, gridRow: `1 / span ${count}` } : { gridColumn: 2, gridRow: order + 1 };
}

/**
 * Painel central com as transmissões abertas: a sua (prévia) e as que você assiste, uma ou várias ao mesmo
 * tempo. Com várias, uma fica em destaque (grande, com som) e as outras pequenas; dá para trocar qual é a
 * grande, ver todas do mesmo tamanho (grade), pôr qualquer uma em tela cheia e fechar uma por vez.
 */
export function StreamStage() {
  const { state, actions } = useRealtime();
  const { stages } = state;
  const count = stages.length;
  const many = count > 1;
  const layout = many ? state.stageLayout : 'focus';
  const focus = state.focusedStage && stages.includes(state.focusedStage) ? state.focusedStage : stages[count - 1];
  // A posição entre as pequenas (a grande não conta).
  const smallOrder = new Map(stages.filter((id) => id !== focus).map((id, i) => [id, i]));

  // O arranjo segue o formato do espaço: janela larga põe as transmissões lado a lado, monitor em pé empilha.
  const areaRef = useRef<HTMLDivElement>(null);
  const area = useElementSize(areaRef);
  const stacked = many && area !== null && area.width < area.height;
  const gridColumns = area
    ? bestGrid({ ...area, count, gap: GAP, extraHeight: TILE_HEADER }).columns
    : count === 1
      ? 1
      : 2;

  const grid: CSSProperties =
    layout === 'grid'
      ? {
          gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${Math.ceil(count / gridColumns)}, minmax(0, 1fr))`,
        }
      : stacked
        ? { gridTemplateColumns: `repeat(${count - 1}, minmax(0, 1fr))`, gridTemplateRows: `minmax(0, 1fr) ${STACKED_STRIP}` }
        : many
          ? { gridTemplateColumns: `minmax(0, 1fr) ${SIDE_COLUMN}`, gridTemplateRows: `repeat(${count - 1}, auto) minmax(0, 1fr)` }
          : { gridTemplateColumns: 'minmax(0, 1fr)', gridTemplateRows: 'minmax(0, 1fr)' };

  return (
    <>
      {many && (
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4 shadow-sm">
          <Monitor size={20} className="shrink-0 text-faint" />
          <h2 className="truncate font-semibold">Transmissões abertas ({count})</h2>
          <div className="ml-auto flex rounded-md bg-rail p-0.5" role="group" aria-label="Disposição das transmissões">
            <LayoutButton
              active={layout === 'focus'}
              label="Uma em destaque"
              onClick={() => actions.setStageLayout('focus')}
              icon={<PanelRight size={16} />}
            />
            <LayoutButton
              active={layout === 'grid'}
              label="Todas do mesmo tamanho"
              onClick={() => actions.setStageLayout('grid')}
              icon={<LayoutGrid size={16} />}
            />
          </div>
          <button
            type="button"
            onClick={() => actions.closeStage()}
            className="rounded-md px-2.5 py-1.5 text-sm text-muted hover:bg-hover hover:text-fg"
          >
            Fechar todas
          </button>
        </header>
      )}
      <div ref={areaRef} className="grid min-h-0 flex-1 gap-1 bg-black/60" style={grid} data-layout={layout} data-stacked={stacked}>
        {stages.map((userId) => {
          const isFocus = userId === focus;
          const variant = !many ? 'main' : layout === 'grid' ? 'cell' : isFocus ? 'main' : 'small';
          return (
            <StreamTile
              key={userId}
              userId={userId}
              variant={variant}
              isFocus={isFocus}
              many={many}
              style={placement(layout, count, isFocus, smallOrder.get(userId) ?? 0, stacked)}
            />
          );
        })}
      </div>
    </>
  );
}

function LayoutButton({ active, label, onClick, icon }: { active: boolean; label: string; onClick: () => void; icon: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className={`rounded p-1.5 ${active ? 'bg-accent text-white' : 'text-muted hover:text-fg'}`}
    >
      {icon}
    </button>
  );
}

type Variant = 'main' | 'cell' | 'small';

/** Uma transmissão: o vídeo e o que se faz com ele. `small` é a miniatura, com os botões por cima. */
function StreamTile({
  userId,
  variant,
  isFocus,
  many,
  style,
}: {
  userId: Id;
  variant: Variant;
  isFocus: boolean;
  many: boolean;
  style: CSSProperties;
}) {
  const { state, actions } = useRealtime();
  const isMe = userId === state.me?.id;
  const found = findParticipant(state.voice, userId);
  const live = isMe ? state.myVoice.streaming : Boolean(found?.self.streaming);
  const stream = isMe ? state.myScreen : (state.screens[userId] ?? null);
  const viewers = (found?.room ?? []).filter((p) => p.watching.includes(userId));
  const name = isMe ? 'Sua tela' : `Tela de ${displayNameOf(state.snapshot, state.users, userId)}`;
  const small = variant === 'small';

  const boxRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [volume, setVolume] = useState(1);
  // Com várias abertas só a que está em destaque toca som; cada uma pode ser ligada à mão.
  const [muted, setMuted] = useState(many && !isFocus);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [hasAudio, setHasAudio] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [configuring, setConfiguring] = useState(false);
  const stats = useStreamStats(userId, showStats && live, actions.screenStats);

  useEffect(() => {
    setMuted(many && !isFocus);
  }, [many, isFocus]);

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
    const onChange = () => setFullscreen(document.fullscreenElement === boxRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement === boxRef.current) void document.exitFullscreen();
    else void boxRef.current?.requestFullscreen();
  };
  /** Amplia: esta passa a ser a grande, as outras ficam pequenas. */
  const expand = () => {
    actions.setStageLayout('focus');
    actions.focusStage(userId);
  };
  const close = () => actions.closeStage(userId);

  const viewerNames = viewers.map((v) => displayNameOf(state.snapshot, state.users, v.userId)).join(', ');
  // A prévia nunca toca som (eco); quem está com o som desativado não ouve a tela.
  const silent = isMe || state.myVoice.deafened || muted;
  const soundButton = !isMe && hasAudio && (
    <button
      type="button"
      onClick={() => setMuted((m) => !m)}
      aria-label={silent ? 'Ativar o som da transmissão' : 'Silenciar a transmissão'}
      title={silent ? 'Ativar o som' : 'Silenciar'}
      className="rounded p-1 text-white hover:bg-white/10"
    >
      {silent ? <VolumeX size={18} /> : <Volume2 size={18} />}
    </button>
  );

  return (
    <section
      style={style}
      aria-label={name}
      className={`flex min-h-0 min-w-0 flex-col bg-panel ${isFocus && many ? 'ring-1 ring-accent/60' : ''}`}
    >
      {!small && (
        <header className={`flex shrink-0 items-center gap-2 border-b border-line px-4 shadow-sm ${variant === 'main' && !many ? 'h-12' : 'h-10'}`}>
          <Monitor size={variant === 'main' ? 20 : 18} className="shrink-0 text-faint" />
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
              onClick={() => void actions.switchScreenShare()}
              title="Trocar a janela ou tela transmitida"
              aria-label="Trocar a janela ou tela transmitida"
              className="ml-auto rounded p-1.5 text-muted hover:bg-hover hover:text-fg"
            >
              <Replace size={18} />
            </button>
          )}
          {live && isMe && (
            <button
              type="button"
              onClick={() => setConfiguring(true)}
              title="Configurações da transmissão"
              aria-label="Configurações da transmissão"
              className="rounded p-1.5 text-muted hover:bg-hover hover:text-fg"
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
            onClick={close}
            title={isMe ? 'Fechar prévia (a transmissão continua)' : 'Parar de assistir'}
            aria-label={isMe ? 'Fechar prévia' : 'Parar de assistir'}
            className={`rounded p-1.5 text-muted hover:bg-hover hover:text-fg ${live ? '' : 'ml-auto'}`}
          >
            <X size={18} />
          </button>
        </header>
      )}

      <div ref={boxRef} className="group relative flex min-h-0 flex-1 items-center justify-center bg-black">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={silent}
          aria-label={name}
          onResize={(e) => setSize({ width: e.currentTarget.videoWidth, height: e.currentTarget.videoHeight })}
          className={`h-full w-full object-contain ${live && stream ? '' : 'hidden'}`}
        />

        {!live && (
          <div className="flex flex-col items-center gap-3 p-4 text-center">
            <MonitorOff size={small ? 24 : 40} className="text-faint" />
            <p className={small ? 'text-sm font-semibold' : 'text-lg font-semibold'}>
              {isMe ? 'Você parou de transmitir.' : 'A transmissão terminou.'}
            </p>
            <button type="button" onClick={close} className="rounded-md bg-elevated px-3 py-1.5 text-sm font-medium hover:bg-hover">
              Fechar
            </button>
          </div>
        )}
        {live && !stream && (
          <p className="animate-pulse px-2 text-center text-sm text-muted" role="status">
            Conectando à transmissão…
          </p>
        )}

        {showStats && live && <StatsPanel stats={stats} />}

        {small ? (
          <>
            <span className="pointer-events-none absolute bottom-1 left-1 max-w-[70%] truncate rounded bg-black/65 px-1.5 py-0.5 text-xs text-white">
              {name}
            </span>
            <div className="absolute top-1 right-1 flex items-center gap-0.5 rounded bg-black/65 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
              {soundButton}
              <button
                type="button"
                onClick={expand}
                aria-label={`Ampliar ${name}`}
                title="Ampliar (as outras ficam pequenas)"
                className="rounded p-1 text-white hover:bg-white/10"
              >
                <Maximize2 size={16} />
              </button>
              <button
                type="button"
                onClick={toggleFullscreen}
                aria-label={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
                title={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
                className="rounded p-1 text-white hover:bg-white/10"
              >
                {fullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
              </button>
              <button
                type="button"
                onClick={close}
                aria-label={isMe ? 'Fechar prévia' : 'Parar de assistir'}
                title={isMe ? 'Fechar prévia (a transmissão continua)' : 'Parar de assistir'}
                className="rounded p-1 text-white hover:bg-white/10"
              >
                <X size={16} />
              </button>
            </div>
          </>
        ) : (
          live &&
          stream && (
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
                  {soundButton}
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
              {variant === 'cell' && (
                <button
                  type="button"
                  onClick={expand}
                  aria-label={`Ampliar ${name}`}
                  title="Ampliar (as outras ficam pequenas)"
                  className="ml-auto rounded p-1.5 text-white hover:bg-white/10"
                >
                  <Maximize2 size={18} />
                </button>
              )}
              <button
                type="button"
                onClick={toggleFullscreen}
                aria-label={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
                title={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
                className={`${variant === 'cell' ? '' : 'ml-auto'} rounded p-1.5 text-white hover:bg-white/10`}
              >
                {fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
              </button>
            </div>
          )
        )}
      </div>
      {configuring && live && <StreamSettingsDialog onClose={() => setConfiguring(false)} />}
    </section>
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

/** O que fazer, em palavras, para cada causa que o diagnóstico (shared/stream-quality.ts) aponta. */
const ADVICE: Record<StreamAdvice, string> = {
  'cpu-software':
    'O processador está codificando o vídeo e no limite: em Configurações da transmissão, escolha H.264 (placa de vídeo), ou uma resolução menor ou menos quadros por segundo.',
  cpu: 'Seu computador está no limite: o jogo e a transmissão disputam a máquina. Escolha uma resolução menor ou menos quadros por segundo.',
  'bandwidth-sfu':
    'A sua internet de envio está no limite: a imagem é reduzida para caber. Escolha uma resolução menor ou menos quadros por segundo.',
  'bandwidth-p2p': 'A sua internet de envio está no limite: a imagem é reduzida para caber. Menos gente assistindo melhora.',
  'path-limit':
    'O caminho até o servidor só comporta uma parte do que a qualidade pede: a imagem fica com menos detalhe para caber. Um upload maior ou uma resolução menor ajuda; Wi-Fi fraco e downloads em paralelo também pesam.',
  'loss-far':
    'Há perda de pacotes e o servidor está longe (a ida e volta é longa): cada pacote perdido demora a ser reenviado, e aparece como travada. Cabo de rede em vez de Wi-Fi ajuda.',
  loss: 'Há perda de pacotes no caminho: a imagem pode travar ou ficar com blocos. Cabo de rede em vez de Wi-Fi ajuda.',
  'freezes-loss': 'A imagem travou algumas vezes por perda de pacotes entre o servidor e você: veja o Wi-Fi ou o que mais usa a sua internet.',
  'freezes-source':
    'A imagem travou algumas vezes sem perda de pacotes aqui: quem transmite está mandando poucos quadros. Peça para ele abrir as estatísticas dele e ver se é o computador ou a internet.',
};

function advice(stats: StreamStats): string | null {
  const code = diagnoseStream(stats);
  return code ? ADVICE[code] : null;
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
            {stats.codec ? `${stats.codec} · ` : ''}
            {stats.encoder ? `${stats.encoder === 'hardware' ? 'placa de vídeo' : 'processador'} · ` : ''}perda {stats.lossPercent.toFixed(1)}%
            {stats.rttMs !== null ? ` · ${Math.round(stats.rttMs)} ms` : ''}
          </p>
          {stats.role === 'sending' && stats.capKbps !== null && (
            <p>
              teto {mbps(stats.capKbps)}
              {stats.availableKbps !== null ? ` · a rede comporta ${mbps(stats.availableKbps)}` : ''}
            </p>
          )}
          {stats.role === 'receiving' && stats.freezes > 0 && (
            <p>
              travou {stats.freezes} {stats.freezes === 1 ? 'vez' : 'vezes'} nos últimos 30 s
            </p>
          )}
          {tip && <p className="mt-1 text-idle">{tip}</p>}
        </>
      )}
    </div>
  );
}

import { bestGrid } from '@shared/grid';
import type { Id, VoiceParticipant } from '@shared/models';
import { MonitorUp, Volume2, X } from 'lucide-react';
import { useRef } from 'react';
import { useElementSize } from '../lib/useElementSize';
import { useRealtime } from '../state/realtime';
import { displayNameOf } from '../state/selectors';
import { ParticipantTile } from './ParticipantTile';
import { LiveBadge } from './StreamStage';

/** Espaço entre os quadros (`gap-3`) e o menor quadro aceitável antes de o mosaico passar a rolar, em pixels. */
const TILE_GAP = 12;
const MIN_TILE_WIDTH = 220;

/**
 * Mosaico da chamada, como a visão de canal de voz do Discord: um quadro por
 * pessoa (câmera ou avatar, com o anel de quem fala) e um cartão para cada
 * transmissão de tela, que abre no palco ao clicar. Os botões da chamada (câmera, tela, música, sons, sair)
 * ficam na barra acima do seu nome, na lateral (VoiceStatusBar), e não aqui.
 */
export function CallView() {
  const { state, actions } = useRealtime();
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
    </>
  );
}

function StreamCard({ participant, isMe }: { participant: VoiceParticipant; isMe: boolean }) {
  const { state, actions } = useRealtime();
  const name = displayNameOf(state.snapshot, state.users, participant.userId);
  const room = state.myVoice.channelId ? (state.voice[state.myVoice.channelId] ?? []) : [];
  const viewers = room.filter((p: VoiceParticipant) => p.watching.includes(participant.userId)).length;
  return (
    <li className="relative flex aspect-video flex-col items-center justify-center gap-3 rounded-2xl bg-panel p-4 text-center">
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

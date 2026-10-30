import type { MusicControl, MusicState, MusicTrackInfo } from '@shared/protocol';
import { ArrowUpToLine, ListMusic, Music2, Pause, Play, Shuffle, SkipForward, Square, Trash2, Volume2, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRealtime } from '../state/realtime';
import { Modal } from './Modal';

/** "3:35" ou "1:02:05"; vazio quando a duração não é conhecida. */
export function formatClock(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '';
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/** O estado do bot na sala em que você está, ou `null` se ele não está lá. */
export function useMusic(): { state: MusicState; receivedAt: number } | null {
  const { state } = useRealtime();
  const music = state.music;
  return music && music.state.channelId === state.myVoice.channelId ? music : null;
}

/** A posição da música agora: a que o servidor mandou mais o tempo que passou aqui (se não está pausada). */
export function usePosition(music: { state: MusicState; receivedAt: number } | null): number {
  const [now, setNow] = useState(() => Date.now());
  const running = Boolean(music?.state.current) && !music?.state.paused;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [running]);
  const current = music?.state.current;
  if (!music || !current) return 0;
  const elapsed = running ? Math.max(0, now - music.receivedAt) : 0;
  const position = current.positionMs + elapsed;
  return current.durationSeconds ? Math.min(position, current.durationSeconds * 1000) : position;
}

const iconButton =
  'flex h-9 w-9 items-center justify-center rounded-full bg-elevated text-fg hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40';

/**
 * O painel do bot de música: o que toca, a fila e os botões, sem precisar decorar comandos de chat.
 * Qualquer pessoa na sala de voz pode pedir e controlar.
 */
export function MusicDialog({ onClose }: { onClose: () => void }) {
  const { actions } = useRealtime();
  const music = useMusic();
  const position = usePosition(music);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function control(request: MusicControl) {
    setMessage(null);
    const error = await actions.musicControl(request);
    if (error) setMessage({ text: error, error: true });
  }

  async function add(next: boolean) {
    const text = input.trim();
    if (!text || busy) return;
    setBusy(true);
    setMessage(null);
    const result = await actions.musicPlay(text, next);
    setBusy(false);
    if ('error' in result) setMessage({ text: result.error, error: true });
    else {
      setInput('');
      if (result.message) setMessage({ text: result.message.replace(/\*\*/g, ''), error: false });
    }
  }

  return (
    <Modal title="Audio Democrático" description="O Coreto Música toca na sua sala de voz. Todo mundo na sala pode pedir e controlar." onClose={onClose}>
      <NowPlaying
        music={music?.state ?? null}
        positionMs={position}
        onControl={(request) => void control(request)}
      />

      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void add(false);
        }}
        className="mt-5 flex gap-2"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={600}
          placeholder="Link do YouTube ou Spotify, ou o nome da música"
          aria-label="Música para tocar"
          data-autofocus
          className="min-w-0 flex-1 rounded-md bg-rail px-3 py-2.5 text-fg outline-none placeholder:text-faint focus:ring-2 focus:ring-accent"
        />
        <button
          type="submit"
          disabled={busy || input.trim() === ''}
          className="shrink-0 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-strong disabled:opacity-50"
        >
          {busy ? 'Buscando…' : 'Adicionar'}
        </button>
        <button
          type="button"
          onClick={() => void add(true)}
          disabled={busy || input.trim() === ''}
          title="Coloca na frente da fila, para tocar logo depois da que está tocando"
          className="shrink-0 rounded-md bg-elevated px-3 py-2 text-sm font-semibold text-fg hover:bg-hover disabled:opacity-50"
        >
          Tocar a seguir
        </button>
      </form>
      <div aria-live="polite" className="mt-2 min-h-5 text-sm">
        {message && <p className={message.error ? 'text-dnd' : 'text-muted'}>{message.text}</p>}
        {!message && music?.state.notice && <p className="text-dnd">{music.state.notice}</p>}
      </div>

      <Queue
        tracks={music?.state.queue ?? []}
        onRemove={(id) => void control({ action: 'remove', id })}
        onPlayNext={(id) => void control({ action: 'top', id })}
        onShuffle={() => void control({ action: 'shuffle' })}
        onClear={() => void control({ action: 'clear' })}
      />

      <div className="mt-6 flex justify-end">
        <button type="button" onClick={onClose} className="rounded-md px-4 py-2 text-sm font-medium text-muted hover:text-fg">
          Fechar
        </button>
      </div>
    </Modal>
  );
}

function NowPlaying({
  music,
  positionMs,
  onControl,
}: {
  music: MusicState | null;
  positionMs: number;
  onControl: (request: MusicControl) => void;
}) {
  const current = music?.current ?? null;
  const duration = current?.durationSeconds ?? null;
  const percent = duration ? Math.min(100, (positionMs / (duration * 1000)) * 100) : 0;
  // O volume local acompanha o arrastar na hora; o pedido ao servidor sai só quando a mão para.
  const [volume, setVolume] = useState(music?.volume ?? 100);
  const sending = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (music && sending.current === null) setVolume(music.volume);
  }, [music?.volume, music]);
  useEffect(() => () => void (sending.current && clearTimeout(sending.current)), []);

  const changeVolume = (value: number) => {
    setVolume(value);
    if (sending.current) clearTimeout(sending.current);
    sending.current = setTimeout(() => {
      sending.current = null;
      onControl({ action: 'volume', volume: value });
    }, 200);
  };

  if (!music || !current) {
    return (
      <div className="flex items-center gap-3 rounded-lg bg-rail p-4 text-muted">
        <Music2 size={28} className="shrink-0 text-faint" aria-hidden />
        <p className="text-sm">{music ? 'Nada tocando. Peça uma música abaixo.' : 'Peça uma música abaixo e o bot entra na sala.'}</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-rail p-4">
      <div className="flex items-start gap-3">
        <Music2 size={28} className="mt-0.5 shrink-0 text-accent" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-fg" title={current.title}>
            {current.title}
          </p>
          <p className="truncate text-sm text-muted">
            {current.artist ? `${current.artist} · ` : ''}pedido por {current.requestedBy}
          </p>
        </div>
      </div>

      <div className="mt-3" role="progressbar" aria-label="Progresso da música" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}>
        <div className="h-1.5 overflow-hidden rounded-full bg-elevated">
          <div className="h-full rounded-full bg-accent" style={{ width: `${duration ? percent : 0}%` }} />
        </div>
        <div className="mt-1 flex justify-between text-xs text-faint">
          <span>{formatClock(positionMs / 1000)}</span>
          <span>{formatClock(duration)}</span>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onControl({ action: music.paused ? 'resume' : 'pause' })}
          aria-label={music.paused ? 'Continuar' : 'Pausar'}
          title={music.paused ? 'Continuar' : 'Pausar'}
          className={iconButton}
        >
          {music.paused ? <Play size={18} /> : <Pause size={18} />}
        </button>
        <button type="button" onClick={() => onControl({ action: 'skip' })} aria-label="Pular" title="Pular" className={iconButton}>
          <SkipForward size={18} />
        </button>
        <button type="button" onClick={() => onControl({ action: 'stop' })} aria-label="Parar e tirar o bot da chamada" title="Parar e tirar o bot da chamada" className={iconButton}>
          <Square size={16} />
        </button>
        <label className="ml-auto flex items-center gap-2 text-muted">
          <Volume2 size={18} aria-hidden />
          <span className="sr-only">Volume do bot para todos</span>
          <input
            type="range"
            min={0}
            max={150}
            step={5}
            value={volume}
            onChange={(e) => changeVolume(Number(e.target.value))}
            className="w-28 accent-accent"
          />
          <span className="w-9 text-right text-xs tabular-nums">{volume}%</span>
        </label>
      </div>
    </div>
  );
}

function Queue({
  tracks,
  onRemove,
  onPlayNext,
  onShuffle,
  onClear,
}: {
  tracks: MusicTrackInfo[];
  onRemove: (id: string) => void;
  onPlayNext: (id: string) => void;
  onShuffle: () => void;
  onClear: () => void;
}) {
  if (tracks.length === 0) return null;
  const total = tracks.reduce((sum, t) => sum + (t.durationSeconds ?? 0), 0);
  return (
    <section aria-label="Fila" className="mt-4">
      <div className="flex items-center gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted uppercase">
          <ListMusic size={14} aria-hidden />
          Na fila ({tracks.length}){total > 0 ? ` · ${formatClock(total)}` : ''}
        </h3>
        <button
          type="button"
          onClick={onShuffle}
          disabled={tracks.length < 2}
          className="ml-auto flex items-center gap-1 rounded px-2 py-1 text-xs text-muted hover:bg-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Shuffle size={13} aria-hidden />
          Embaralhar
        </button>
        <button type="button" onClick={onClear} className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted hover:bg-hover hover:text-fg">
          <Trash2 size={13} aria-hidden />
          Limpar fila
        </button>
      </div>
      <ol className="mt-2 max-h-56 space-y-1 overflow-y-auto">
        {tracks.map((track, i) => (
          <li key={track.id} className="flex items-center gap-2 rounded-md bg-rail px-3 py-2">
            <span className="w-5 shrink-0 text-right text-xs text-faint tabular-nums">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-fg" title={track.title}>
                {track.title}
              </p>
              <p className="truncate text-xs text-faint">
                {track.artist ? `${track.artist} · ` : ''}
                {formatClock(track.durationSeconds)}
                {track.durationSeconds ? ' · ' : ''}
                {track.requestedBy}
              </p>
            </div>
            {i > 0 && (
              <button
                type="button"
                onClick={() => onPlayNext(track.id)}
                aria-label={`Tocar ${track.title} a seguir`}
                title="Tocar a seguir"
                className="shrink-0 rounded p-1.5 text-faint hover:bg-hover hover:text-fg"
              >
                <ArrowUpToLine size={15} />
              </button>
            )}
            <button
              type="button"
              onClick={() => onRemove(track.id)}
              aria-label={`Tirar ${track.title} da fila`}
              title="Tirar da fila"
              className="shrink-0 rounded p-1.5 text-faint hover:bg-hover hover:text-dnd"
            >
              <X size={15} />
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

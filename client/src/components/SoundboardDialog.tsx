import type { SoundClip } from '@shared/models';
import { cleanSoundEmoji, cleanSoundName, MAX_SOUND_NAME, MAX_SOUNDS_PER_SPACE } from '@shared/sounds';
import { Music2, Square, Trash2, Upload } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useRealtime } from '../state/realtime';
import { fieldClass, Modal } from './Modal';

/** Preferências só deste computador (volume do quadro e se você ouve o que toca). */
function usePref<T>(key: string, fallback: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  });
  return [
    value,
    (next) => {
      setValue(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // sem armazenamento: vale só até fechar
      }
    },
  ];
}

const nameFromFile = (file: File) => cleanSoundName(file.name.replace(/\.[^.]+$/, '')) ?? '';

/** O quadro de som do espaço: um clique toca o som para a chamada toda, pelo seu microfone. */
export function SoundboardDialog({ onClose }: { onClose: () => void }) {
  const { state, actions } = useRealtime();
  const spaceId = state.snapshot?.space.id;
  const clips = spaceId ? (state.sounds[spaceId] ?? []) : [];
  const inCall = Boolean(state.myVoice.channelId);
  const deafened = state.myVoice.deafened;
  const [volume, setVolume] = usePref('coreto.soundboard.volume', 0.8);
  const [hearMine, setHearMine] = usePref('coreto.soundboard.hearMine', true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (spaceId) void actions.loadSounds(spaceId).then(setError);
  }, [actions, spaceId]);

  async function play(clip: SoundClip) {
    setError(null);
    setError(await actions.playSound(clip, volume, hearMine ? 0.8 : 0));
  }

  return (
    <Modal title="Quadro de som" description="Um clique toca o som para todo mundo na chamada." onClose={onClose}>
      {!inCall && <p className="mb-3 rounded-md bg-rail px-3 py-2 text-sm text-muted">Entre em uma chamada para tocar os sons.</p>}
      {inCall && deafened && <p className="mb-3 rounded-md bg-rail px-3 py-2 text-sm text-muted">Ative o som para tocar os sons.</p>}

      {clips.length === 0 ? (
        <p className="rounded-md bg-rail px-3 py-6 text-center text-sm text-muted">Nenhum som ainda. Acrescente o primeiro abaixo.</p>
      ) : (
        <ul className="grid max-h-64 grid-cols-3 gap-2 overflow-y-auto">
          {clips.map((clip) => (
            <ClipButton key={clip.id} clip={clip} disabled={!inCall || deafened} mine={clip.uploaderId === state.me?.id} onPlay={() => void play(clip)} />
          ))}
        </ul>
      )}

      <div className="mt-4 flex items-center gap-3">
        <label htmlFor="sound-volume" className="shrink-0 text-xs font-semibold tracking-wide text-muted uppercase">
          Volume
        </label>
        <input
          id="sound-volume"
          type="range"
          min={0.1}
          max={1}
          step={0.05}
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          className="min-w-0 flex-1 accent-[var(--color-accent)]"
        />
        <button
          type="button"
          onClick={actions.stopSounds}
          disabled={!inCall}
          className="flex shrink-0 items-center gap-1 rounded-md bg-elevated px-2.5 py-1.5 text-sm font-medium text-muted hover:bg-hover hover:text-fg disabled:opacity-50"
        >
          <Square size={13} aria-hidden /> Parar
        </button>
      </div>
      <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm">
        <input type="checkbox" checked={hearMine} onChange={(e) => setHearMine(e.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" />
        Ouvir o som que eu toco
        <span className="text-xs text-faint">(com caixa de som, desligue: o microfone repete o som)</span>
      </label>

      {error && (
        <p role="alert" className="mt-3 text-sm text-dnd">
          {error}
        </p>
      )}

      {spaceId && clips.length < MAX_SOUNDS_PER_SPACE ? (
        <AddSound spaceId={spaceId} />
      ) : (
        <p className="mt-4 text-xs text-faint">O quadro está cheio ({MAX_SOUNDS_PER_SPACE} sons). Remova algum para acrescentar outro.</p>
      )}

      <div className="mt-5 flex justify-end">
        <button type="button" onClick={onClose} className="rounded-md px-4 py-2 text-sm font-medium text-muted hover:text-fg">
          Fechar
        </button>
      </div>
    </Modal>
  );
}

function ClipButton({ clip, disabled, mine, onPlay }: { clip: SoundClip; disabled: boolean; mine: boolean; onPlay: () => void }) {
  const { actions } = useRealtime();
  const [removing, setRemoving] = useState(false);
  return (
    <li className="group relative">
      <button
        type="button"
        onClick={onPlay}
        disabled={disabled}
        title={clip.name}
        className="flex h-16 w-full flex-col items-center justify-center gap-0.5 rounded-md bg-rail px-1 text-center hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
      >
        {clip.emoji ? <span className="text-xl leading-none">{clip.emoji}</span> : <Music2 size={18} className="text-muted" aria-hidden />}
        <span className="w-full truncate text-xs font-medium">{clip.name}</span>
      </button>
      {mine && (
        <button
          type="button"
          disabled={removing}
          onClick={() => {
            setRemoving(true);
            void actions.removeSound(clip.id).finally(() => setRemoving(false));
          }}
          aria-label={`Remover o som ${clip.name}`}
          title="Remover"
          className="absolute top-0.5 right-0.5 rounded p-1 text-faint opacity-0 hover:bg-dnd/20 hover:text-dnd focus-visible:opacity-100 group-hover:opacity-100"
        >
          <Trash2 size={12} />
        </button>
      )}
    </li>
  );
}

function AddSound({ spaceId }: { spaceId: string }) {
  const { actions } = useRealtime();
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const cleanName = cleanSoundName(name);
  const cleanEmoji = cleanSoundEmoji(emoji);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file || !cleanName || busy) return;
    setBusy(true);
    const err = await actions.addSound(spaceId, file, cleanName, cleanEmoji);
    setBusy(false);
    if (err) return setError(err);
    setFile(null);
    setName('');
    setEmoji('');
    setError(null);
  }

  return (
    <form onSubmit={submit} className="mt-4 border-t border-line pt-4">
      <p className="text-xs font-semibold tracking-wide text-muted uppercase">Acrescentar um som</p>
      <div className="mt-2 flex items-center gap-2">
        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md bg-rail px-3 py-2 text-sm hover:bg-hover">
          <Upload size={15} className="shrink-0 text-muted" aria-hidden />
          <span className="truncate">{file ? file.name : 'Escolher áudio (MP3, OGG, WAV…)'}</span>
          <input
            type="file"
            accept="audio/*,.mp3,.ogg,.wav,.m4a,.webm"
            hidden
            onChange={(e) => {
              const picked = e.target.files?.[0] ?? null;
              e.target.value = '';
              setError(null);
              setFile(picked);
              if (picked && !name) setName(nameFromFile(picked));
            }}
          />
        </label>
      </div>
      {file && (
        <div className="mt-2 flex gap-2">
          <input
            value={emoji}
            onChange={(e) => setEmoji(e.target.value)}
            aria-label="Emoji (opcional)"
            placeholder="😀"
            maxLength={16}
            className="w-14 rounded-md bg-rail px-2 py-2 text-center text-fg outline-none placeholder:text-faint focus:ring-2 focus:ring-accent"
          />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Nome do som"
            placeholder="Nome do som"
            maxLength={MAX_SOUND_NAME}
            className={`${fieldClass} mt-0 min-w-0 flex-1 py-2`}
          />
          <button
            type="submit"
            disabled={!cleanName || busy}
            className="shrink-0 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-strong disabled:opacity-50"
          >
            {busy ? 'Enviando…' : 'Acrescentar'}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-dnd">
          {error}
        </p>
      )}
    </form>
  );
}

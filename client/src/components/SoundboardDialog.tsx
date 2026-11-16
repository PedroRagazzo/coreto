import type { SoundClip } from '@shared/models';
import { cleanSoundEmoji, cleanSoundName, MAX_SOUND_NAME, MAX_SOUNDS_PER_SPACE } from '@shared/sounds';
import { Check, Keyboard, Music2, Play, Square, Trash2, Upload, Volume2, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { formatKeybind, sameKeys } from '../lib/keybinds';
import { SOUND_GAIN_RANGE } from '../lib/settings';
import { SOUNDBOARD_HEAR_MINE_KEY, SOUNDBOARD_VOLUME_KEY } from '../lib/soundboard';
import { useKeybindRecorder } from '../lib/useKeybindRecorder';
import { useRealtime } from '../state/realtime';
import { useSettings } from '../state/settings';
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
  const [volume, setVolume] = usePref(SOUNDBOARD_VOLUME_KEY, 0.8);
  const [hearMine, setHearMine] = usePref(SOUNDBOARD_HEAR_MINE_KEY, true);
  const [error, setError] = useState<string | null>(null);
  const { settings, update } = useSettings();
  const binds = settings.soundKeybinds;
  const gains = settings.soundVolumes;
  /** O som cujo volume está sendo ajustado agora. */
  const [adjusting, setAdjusting] = useState<string | null>(null);
  /** O som cujo atalho está sendo gravado agora. */
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    if (spaceId) void actions.loadSounds(spaceId).then(setError);
  }, [actions, spaceId]);

  function setBind(clipId: string, keys: string[] | null) {
    const taken =
      keys &&
      [settings.keybinds.mute, settings.keybinds.deafen, ...Object.entries(binds).filter(([id]) => id !== clipId).map(([, other]) => other)].some(
        (other) => other && sameKeys(keys, other),
      );
    if (taken) return setError('Essa combinação já está em uso por outro atalho.');
    setError(null);
    update((s) => {
      const next = { ...s.soundKeybinds };
      if (keys) next[clipId] = keys;
      else delete next[clipId];
      return { ...s, soundKeybinds: next };
    });
  }

  const recorder = useKeybindRecorder((keys) => target && setBind(target, keys), setError);

  async function play(clip: SoundClip) {
    setError(null);
    setError(await actions.playSound(clip, volume * (gains[clip.id] ?? 1), hearMine ? 0.8 : 0));
  }

  function setGain(clipId: string, gain: number) {
    update((s) => {
      const next = { ...s.soundVolumes };
      if (gain === 1) delete next[clipId];
      else next[clipId] = gain;
      return { ...s, soundVolumes: next };
    });
  }

  /** O som saiu do quadro: o atalho e o volume dele não servem mais. */
  function forget(clipId: string) {
    update((s) => {
      const keybinds = { ...s.soundKeybinds };
      const volumes = { ...s.soundVolumes };
      delete keybinds[clipId];
      delete volumes[clipId];
      return { ...s, soundKeybinds: keybinds, soundVolumes: volumes };
    });
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
              <ClipButton
                key={clip.id}
                clip={clip}
                disabled={!inCall || deafened}
                mine={clip.uploaderId === state.me?.id}
                onPlay={() => void play(clip)}
                bind={binds[clip.id] ?? null}
                recording={recorder.recording && target === clip.id}
                held={recorder.held}
                onRecord={() => {
                  setError(null);
                  if (recorder.recording && target === clip.id) return recorder.setRecording(false);
                  setTarget(clip.id);
                  recorder.setRecording(true);
                }}
                onClearBind={() => setBind(clip.id, null)}
                onForget={() => forget(clip.id)}
                gain={gains[clip.id] ?? 1}
                adjusting={adjusting === clip.id}
                onAdjust={() => setAdjusting((current) => (current === clip.id ? null : clip.id))}
                onGain={(gain) => setGain(clip.id, gain)}
              />
            ))}
          </ul>
      )}
      {clips.length > 0 && (
        <p className="mt-2 text-xs text-faint">
          Em cada som, o ícone de teclado cria um atalho para tocá-lo sem abrir o quadro, e o de volume acerta o quanto ele toca (só vale neste aparelho).
        </p>
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

function ClipButton({
  clip,
  disabled,
  mine,
  onPlay,
  bind,
  recording,
  held,
  onRecord,
  onClearBind,
  onForget,
  gain,
  adjusting,
  onAdjust,
  onGain,
}: {
  clip: SoundClip;
  disabled: boolean;
  mine: boolean;
  onPlay: () => void;
  /** O atalho deste som, se tem. */
  bind: string[] | null;
  /** Está gravando o atalho deste som agora. */
  recording: boolean;
  /** As teclas que estão apertadas durante a gravação. */
  held: string[];
  onRecord: () => void;
  onClearBind: () => void;
  /** O som foi removido do quadro. */
  onForget: () => void;
  /** O volume deste som (1 = como veio). */
  gain: number;
  /** Está ajustando o volume deste som agora. */
  adjusting: boolean;
  onAdjust: () => void;
  onGain: (gain: number) => void;
}) {
  const { actions } = useRealtime();
  const [removing, setRemoving] = useState(false);
  const iconButton = 'rounded p-1 text-faint hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-accent';
  return (
    <li className="group relative">
      {adjusting ? (
        <div className="flex h-16 w-full flex-col justify-center gap-1 rounded-md bg-accent/20 px-2 ring-2 ring-accent">
          <span className="truncate pr-6 text-xs font-medium">{clip.name}</span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onPlay}
              disabled={disabled}
              aria-label={`Ouvir o som ${clip.name}`}
              title="Ouvir com este volume"
              className="shrink-0 rounded p-0.5 hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Play size={12} />
            </button>
            <input
              type="range"
              min={SOUND_GAIN_RANGE.min * 100}
              max={SOUND_GAIN_RANGE.max * 100}
              step={5}
              value={Math.round(gain * 100)}
              onChange={(e) => onGain(Number(e.target.value) / 100)}
              aria-label={`Volume do som ${clip.name}`}
              className="min-w-0 flex-1 accent-[var(--color-accent)]"
            />
            <span className="w-9 shrink-0 text-right text-[10px] tabular-nums">{Math.round(gain * 100)}%</span>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={onPlay}
          disabled={disabled}
          title={bind ? `${clip.name} (atalho: ${formatKeybind(bind)})` : clip.name}
          className={`flex h-16 w-full flex-col items-center justify-center gap-0.5 rounded-md bg-rail px-1 text-center hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 ${
            recording ? 'bg-accent/20 ring-2 ring-accent' : ''
          }`}
        >
          {clip.emoji ? <span className="text-xl leading-none">{clip.emoji}</span> : <Music2 size={18} className="text-muted" aria-hidden />}
          <span className="w-full truncate text-xs font-medium">{recording ? (held.length ? formatKeybind(held) : 'Aperte as teclas…') : clip.name}</span>
          {(bind || gain !== 1) && !recording && (
            <span className="flex items-center gap-1">
              {bind && (
                <span className="flex items-center gap-1 rounded bg-black/30 px-1.5 text-[10px] leading-4 font-semibold text-muted">
                  <Keyboard size={10} aria-hidden />
                  {formatKeybind(bind)}
                </span>
              )}
              {gain !== 1 && (
                <span className="flex items-center gap-0.5 rounded bg-black/30 px-1.5 text-[10px] leading-4 font-semibold text-muted">
                  <Volume2 size={10} aria-hidden />
                  {Math.round(gain * 100)}%
                </span>
              )}
            </span>
          )}
        </button>
      )}
      <div className={`absolute top-0.5 right-0.5 flex ${adjusting ? '' : 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100'}`}>
        <button
          type="button"
          onClick={onAdjust}
          aria-label={`${adjusting ? 'Fechar o volume' : 'Ajustar o volume'} do som ${clip.name}`}
          title={adjusting ? 'Pronto' : 'Ajustar o volume deste som'}
          className={iconButton}
        >
          {adjusting ? <Check size={12} /> : <Volume2 size={12} />}
        </button>
        {!adjusting && (
          <>
            <button
              type="button"
              onClick={onRecord}
              aria-label={`${recording ? 'Cancelar o atalho' : bind ? 'Mudar o atalho' : 'Dar um atalho'} do som ${clip.name}`}
              title={recording ? 'Cancelar' : bind ? 'Mudar o atalho' : 'Dar um atalho'}
              className={iconButton}
            >
              <Keyboard size={12} />
            </button>
            {bind && !recording && (
              <button type="button" onClick={onClearBind} aria-label={`Remover o atalho do som ${clip.name}`} title="Remover o atalho" className={iconButton}>
                <X size={12} />
              </button>
            )}
            {mine && (
              <button
                type="button"
                disabled={removing}
                onClick={() => {
                  setRemoving(true);
                  void actions
                    .removeSound(clip.id)
                    .then((problem) => {
                      if (!problem) onForget();
                    })
                    .finally(() => setRemoving(false));
                }}
                aria-label={`Remover o som ${clip.name}`}
                title="Remover"
                className="rounded p-1 text-faint hover:bg-dnd/20 hover:text-dnd focus-visible:outline-2 focus-visible:outline-accent"
              >
                <Trash2 size={12} />
              </button>
            )}
          </>
        )}
      </div>
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

import { useState, type FormEvent } from 'react';
import { desktop } from '../lib/desktop';
import type { ScreenShareOptions } from '../lib/voice';
import { useRealtime } from '../state/realtime';
import { DialogActions, labelClass, Modal } from './Modal';

const STORAGE_KEY = 'coreto.screenShare';
const DEFAULTS: ScreenShareOptions = { height: 720, frameRate: 30, audio: true, priority: 'sharp', uploadMbps: 10 };

const RESOLUTIONS: { value: ScreenShareOptions['height']; label: string }[] = [
  { value: 720, label: '720p' },
  { value: 1080, label: '1080p' },
  { value: null, label: 'Original' },
];
const FRAME_RATES: ScreenShareOptions['frameRate'][] = [15, 30, 60];
const PRIORITIES: { value: ScreenShareOptions['priority']; label: string }[] = [
  { value: 'sharp', label: 'Nitidez' },
  { value: 'smooth', label: 'Fluidez' },
];
const UPLOADS: ScreenShareOptions['uploadMbps'][] = [5, 10, 20, 50];

/** A última escolha fica no navegador, como conveniência. */
function loadOptions(): ScreenShareOptions {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<ScreenShareOptions> | null;
    return {
      height: RESOLUTIONS.some((r) => r.value === saved?.height) ? saved!.height! : DEFAULTS.height,
      frameRate: FRAME_RATES.includes(saved?.frameRate as never) ? saved!.frameRate! : DEFAULTS.frameRate,
      audio: typeof saved?.audio === 'boolean' ? saved.audio : DEFAULTS.audio,
      priority: PRIORITIES.some((p) => p.value === saved?.priority) ? saved!.priority! : DEFAULTS.priority,
      uploadMbps: UPLOADS.includes(saved?.uploadMbps as never) ? saved!.uploadMbps! : DEFAULTS.uploadMbps,
    };
  } catch {
    return DEFAULTS;
  }
}

function saveOptions(options: ScreenShareOptions): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
  } catch {
    // Sem armazenamento, a escolha vale só agora.
  }
}

/** Qualidade da transmissão; depois, o próprio navegador pergunta qual tela, janela ou aba. */
export function ScreenShareDialog({ onClose }: { onClose: () => void }) {
  const { state, actions } = useRealtime();
  const [options, setOptions] = useState(loadOptions);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    saveOptions(options);
    setBusy(true);
    // Chamado direto do clique: o navegador só abre o seletor de tela a partir de um gesto.
    const err = await actions.startScreenShare(options);
    setBusy(false);
    if (err) setError(err);
    else onClose();
  }

  return (
    <Modal
      title="Compartilhar tela"
      description={`Transmitir em ${state.myVoice.channelName ?? 'canal de voz'}. Só recebe o vídeo quem escolher assistir.`}
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <fieldset>
          <legend className={labelClass}>Resolução</legend>
          <Segmented
            name="resolucao"
            options={RESOLUTIONS.map((r) => ({ key: String(r.value), label: r.label, selected: options.height === r.value }))}
            onSelect={(key) => setOptions((o) => ({ ...o, height: RESOLUTIONS.find((r) => String(r.value) === key)!.value }))}
          />
        </fieldset>

        <fieldset className="mt-4">
          <legend className={labelClass}>Quadros por segundo</legend>
          <Segmented
            name="quadros"
            options={FRAME_RATES.map((fps) => ({ key: String(fps), label: `${fps} fps`, selected: options.frameRate === fps }))}
            onSelect={(key) => setOptions((o) => ({ ...o, frameRate: Number(key) as ScreenShareOptions['frameRate'] }))}
          />
          <p className="mt-1.5 text-xs text-faint">
            60 fps para jogos e vídeos; 15 fps deixa texto e código mais nítidos com menos internet.
          </p>
        </fieldset>

        <fieldset className="mt-4">
          <legend className={labelClass}>Prioridade</legend>
          <Segmented
            name="prioridade"
            options={PRIORITIES.map((p) => ({ key: p.value, label: p.label, selected: options.priority === p.value }))}
            onSelect={(key) => setOptions((o) => ({ ...o, priority: key as ScreenShareOptions['priority'] }))}
          />
          <p className="mt-1.5 text-xs text-faint">
            Nitidez mantém o texto legível e deixa cair quadros se a internet apertar. Fluidez mantém o movimento e deixa a imagem
            perder resolução (jogos e vídeos).
          </p>
        </fieldset>

        <fieldset className="mt-4">
          <legend className={labelClass}>Upload da sua internet</legend>
          <Segmented
            name="upload"
            options={UPLOADS.map((mbps) => ({ key: String(mbps), label: `${mbps} Mbps`, selected: options.uploadMbps === mbps }))}
            onSelect={(key) => setOptions((o) => ({ ...o, uploadMbps: Number(key) as ScreenShareOptions['uploadMbps'] }))}
          />
          <p className="mt-1.5 text-xs text-faint">
            Cada pessoa que assiste recebe uma cópia do vídeo, então este limite é dividido entre elas: quanto mais gente, menor a
            resolução, mas a imagem continua nítida. Se não souber, deixe em 10 Mbps.
          </p>
        </fieldset>

        <label className="mt-4 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={options.audio}
            onChange={(e) => setOptions((o) => ({ ...o, audio: e.target.checked }))}
            className="h-4 w-4 accent-accent"
          />
          {desktop?.appAudio
            ? 'Incluir o som do programa compartilhado (a chamada do Coreto não vai junto)'
            : 'Incluir o som (o navegador oferece para abas e, no Windows, para a tela inteira)'}
        </label>

        {error && (
          <p role="alert" className="mt-3 text-sm text-dnd">
            {error}
          </p>
        )}
        <DialogActions onCancel={onClose} submitLabel={busy ? 'Escolhendo…' : 'Escolher tela'} disabled={busy} />
      </form>
    </Modal>
  );
}

interface SegmentedProps {
  name: string;
  options: { key: string; label: string; selected: boolean }[];
  onSelect: (key: string) => void;
}

function Segmented({ name, options, onSelect }: SegmentedProps) {
  return (
    <div className="mt-2 flex rounded-md bg-rail p-1">
      {options.map((option) => (
        <label
          key={option.key}
          className={`flex-1 cursor-pointer rounded px-3 py-1.5 text-center text-sm font-medium has-focus-visible:outline-2 has-focus-visible:outline-accent ${
            option.selected ? 'bg-accent text-white' : 'text-muted hover:text-fg'
          }`}
        >
          <input
            type="radio"
            name={name}
            value={option.key}
            checked={option.selected}
            onChange={() => onSelect(option.key)}
            className="sr-only"
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}

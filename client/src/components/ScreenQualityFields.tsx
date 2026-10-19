import type { ScreenShareOptions } from '../lib/voice';
import { labelClass } from './Modal';

/** A parte da qualidade que dá para mudar com a transmissão no ar (o som só se escolhe ao começar). */
export type ScreenQuality = Pick<ScreenShareOptions, 'height' | 'frameRate' | 'priority' | 'uploadMbps'>;

const STORAGE_KEY = 'coreto.screenShare';
export const DEFAULT_SCREEN_OPTIONS: ScreenShareOptions = { height: 720, frameRate: 30, audio: true, priority: 'sharp', uploadMbps: 10 };

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
export function loadScreenOptions(): ScreenShareOptions {
  const defaults = DEFAULT_SCREEN_OPTIONS;
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<ScreenShareOptions> | null;
    return {
      height: RESOLUTIONS.some((r) => r.value === saved?.height) ? saved!.height! : defaults.height,
      frameRate: FRAME_RATES.includes(saved?.frameRate as never) ? saved!.frameRate! : defaults.frameRate,
      audio: typeof saved?.audio === 'boolean' ? saved.audio : defaults.audio,
      priority: PRIORITIES.some((p) => p.value === saved?.priority) ? saved!.priority! : defaults.priority,
      uploadMbps: UPLOADS.includes(saved?.uploadMbps as never) ? saved!.uploadMbps! : defaults.uploadMbps,
    };
  } catch {
    return defaults;
  }
}

export function saveScreenOptions(options: ScreenShareOptions): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
  } catch {
    // Sem armazenamento, a escolha vale só agora.
  }
}

/** Resolução, quadros, prioridade e upload: os mesmos controles ao começar e durante a transmissão. */
export function ScreenQualityFields({ value, onChange }: { value: ScreenQuality; onChange: (patch: Partial<ScreenQuality>) => void }) {
  return (
    <>
      <fieldset>
        <legend className={labelClass}>Resolução</legend>
        <Segmented
          name="resolucao"
          options={RESOLUTIONS.map((r) => ({ key: String(r.value), label: r.label, selected: value.height === r.value }))}
          onSelect={(key) => onChange({ height: RESOLUTIONS.find((r) => String(r.value) === key)!.value })}
        />
      </fieldset>

      <fieldset className="mt-4">
        <legend className={labelClass}>Quadros por segundo</legend>
        <Segmented
          name="quadros"
          options={FRAME_RATES.map((fps) => ({ key: String(fps), label: `${fps} fps`, selected: value.frameRate === fps }))}
          onSelect={(key) => onChange({ frameRate: Number(key) as ScreenShareOptions['frameRate'] })}
        />
        <p className="mt-1.5 text-xs text-faint">
          60 fps para jogos e vídeos; 15 fps deixa texto e código mais nítidos com menos internet.
        </p>
      </fieldset>

      <fieldset className="mt-4">
        <legend className={labelClass}>Prioridade</legend>
        <Segmented
          name="prioridade"
          options={PRIORITIES.map((p) => ({ key: p.value, label: p.label, selected: value.priority === p.value }))}
          onSelect={(key) => onChange({ priority: key as ScreenShareOptions['priority'] })}
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
          options={UPLOADS.map((mbps) => ({ key: String(mbps), label: `${mbps} Mbps`, selected: value.uploadMbps === mbps }))}
          onSelect={(key) => onChange({ uploadMbps: Number(key) as ScreenShareOptions['uploadMbps'] })}
        />
        <p className="mt-1.5 text-xs text-faint">
          Cada pessoa que assiste recebe uma cópia do vídeo, então este limite é dividido entre elas: quanto mais gente, menor a
          resolução, mas a imagem continua nítida. Se não souber, deixe em 10 Mbps.
        </p>
      </fieldset>
    </>
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

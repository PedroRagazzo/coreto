import { supportsH264, type ScreenShareOptions } from '../lib/voice';

/** A parte da qualidade que se escolhe ao começar a transmitir (o som é uma escolha à parte). */
export type ScreenQuality = Pick<ScreenShareOptions, 'height' | 'frameRate' | 'priority' | 'uploadMbps' | 'codec'>;

export type LaunchResolution = ScreenShareOptions['height'];
export type LaunchFrameRate = ScreenShareOptions['frameRate'];

/** As resoluções do diálogo de compartilhar. `null` é a "Original": do tamanho da tela, sem reduzir. */
export const LAUNCH_RESOLUTIONS: readonly { value: LaunchResolution; label: string; badge?: string; hint: string }[] = [
  { value: 720, label: '720p', hint: 'Mais leve: bom para internet fraca ou computador simples.' },
  { value: 1080, label: '1080p', hint: 'Nítido e leve para a maioria dos jogos e telas.' },
  { value: 1440, label: '2K', hint: 'Muito nítido (1440p): pede boa internet e uma placa de vídeo forte. Se a sua tela for menor, sai no tamanho dela.' },
  {
    value: null,
    label: 'Original',
    badge: 'recomendado',
    hint: 'Recomendado: a imagem sai exatamente no tamanho da sua tela, sem ser reduzida. Se a sua tela for 4K ou maior, prefira 1080p ou 2K.',
  },
];

export const LAUNCH_FRAME_RATES: readonly LaunchFrameRate[] = [15, 30, 60];

/** Quem codifica o vídeo: a placa de vídeo (H.264) ou o processador (VP8). */
export const ENCODERS = [
  { value: 'h264', label: 'Placa de vídeo' },
  { value: 'vp8', label: 'Processador' },
] as const satisfies readonly { value: ScreenShareOptions['codec']; label: string }[];

/** Quem codificou da última vez; na primeira, a placa de vídeo onde o navegador sabe usá-la. */
export function loadLaunchEncoder(): ScreenShareOptions['codec'] {
  return supportsH264() ? loadScreenOptions().codec : 'vp8';
}

/** A resolução que a pessoa escolheu da última vez (1080p na primeira). */
export function loadLaunchResolution(): LaunchResolution {
  return loadScreenOptions().height;
}

const FPS_KEY = 'coreto.screenShare.fps';

/** Os quadros por segundo que a pessoa escolheu de propósito da última vez; `null` se nunca escolheu (o Coreto decide). */
export function loadLaunchFrameRate(): LaunchFrameRate | null {
  try {
    const saved = Number(localStorage.getItem(FPS_KEY));
    return LAUNCH_FRAME_RATES.find((fps) => fps === saved) ?? null;
  } catch {
    return null;
  }
}

export function saveLaunchFrameRate(fps: LaunchFrameRate | null): void {
  try {
    if (fps === null) localStorage.removeItem(FPS_KEY);
    else localStorage.setItem(FPS_KEY, String(fps));
  } catch {
    // Sem armazenamento, a escolha vale só agora.
  }
}

/**
 * Com esta qualidade toda transmissão começa, na resolução escolhida: 60 fps (o diálogo troca pelo que a pessoa escolher),
 * Fluidez e, onde o navegador sabe, a placa de vídeo codificando. 20 Mbps de upload: o servidor de mídia usa o teto cheio e,
 * na malha P2P, quem tem pouca internet não é sufocado.
 */
export const bestScreenQuality = (height: LaunchResolution = 1080, codec: ScreenShareOptions['codec'] = 'h264'): ScreenQuality => ({
  height,
  frameRate: 60,
  priority: 'smooth',
  uploadMbps: 20,
  codec: codec === 'h264' && supportsH264() ? 'h264' : 'vp8',
});

const STORAGE_KEY = 'coreto.screenShare';
const DEFAULT_SCREEN_OPTIONS: ScreenShareOptions = {
  // 1080p: é o que o diálogo marca na primeira vez.
  height: 1080,
  frameRate: 30,
  audio: true,
  priority: 'sharp',
  uploadMbps: 10,
  // H.264 usa a placa de vídeo para codificar; só vira padrão onde o navegador sabe fazer isso.
  codec: supportsH264() ? 'h264' : 'vp8',
};

const PRIORITIES: ScreenShareOptions['priority'][] = ['sharp', 'smooth'];
const UPLOADS: ScreenShareOptions['uploadMbps'][] = [5, 10, 20, 50];
const CODECS: ScreenShareOptions['codec'][] = ['h264', 'vp8'];

/** A última escolha fica no navegador, como conveniência. */
export function loadScreenOptions(): ScreenShareOptions {
  const defaults = DEFAULT_SCREEN_OPTIONS;
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<ScreenShareOptions> | null;
    return {
      height: LAUNCH_RESOLUTIONS.some((r) => r.value === saved?.height) ? saved!.height! : defaults.height,
      frameRate: LAUNCH_FRAME_RATES.includes(saved?.frameRate as never) ? saved!.frameRate! : defaults.frameRate,
      audio: typeof saved?.audio === 'boolean' ? saved.audio : defaults.audio,
      priority: PRIORITIES.includes(saved?.priority as never) ? saved!.priority! : defaults.priority,
      uploadMbps: UPLOADS.includes(saved?.uploadMbps as never) ? saved!.uploadMbps! : defaults.uploadMbps,
      codec: CODECS.includes(saved?.codec as never) ? saved!.codec! : defaults.codec,
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

export interface SegmentedProps {
  name: string;
  options: { key: string; label: string; selected: boolean; badge?: string }[];
  onSelect: (key: string) => void;
}

export function Segmented({ name, options, onSelect }: SegmentedProps) {
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
          {option.badge && (
            <span className={`ml-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${option.selected ? 'bg-white/20' : 'bg-accent/15 text-accent-text'}`}>
              {option.badge}
            </span>
          )}
        </label>
      ))}
    </div>
  );
}

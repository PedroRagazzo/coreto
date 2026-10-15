// Configurações deste aparelho (navegador ou app de desktop): dispositivos de
// voz e vídeo e aparência. Ficam no localStorage, não no servidor: o microfone
// do notebook não é o mesmo do celular.

export interface VoicePrefs {
  /** `null` = o padrão do sistema. */
  inputDeviceId: string | null;
  outputDeviceId: string | null;
  cameraDeviceId: string | null;
  /** Ganho do microfone: 0 a 2 (1 = 100%). */
  inputVolume: number;
  /** Volume das vozes e da tela de quem você assiste: 0 a 1. */
  outputVolume: number;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
}

export interface AppearancePrefs {
  /** Tamanho do texto das mensagens, em px. */
  messageFontSize: number;
  /** Mensagens em uma linha, sem avatar (como o modo compacto do Discord). */
  compact: boolean;
}

export interface Settings {
  voice: VoicePrefs;
  appearance: AppearancePrefs;
}

export const MESSAGE_FONT_SIZES = { min: 12, max: 20 } as const;

export const DEFAULT_SETTINGS: Settings = {
  voice: {
    inputDeviceId: null,
    outputDeviceId: null,
    cameraDeviceId: null,
    inputVolume: 1,
    outputVolume: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
  appearance: { messageFontSize: 15, compact: false },
};

const STORAGE_KEY = 'coreto.settings';

const clamp = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);
const deviceId = (value: unknown) => (typeof value === 'string' && value ? value : null);

/** Lê o que foi guardado, descartando valores fora do esperado (versões antigas, edição manual). */
export function loadSettings(): Settings {
  let raw: Partial<{ voice: Partial<VoicePrefs>; appearance: Partial<AppearancePrefs> }> = {};
  try {
    raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') ?? {};
  } catch {
    // armazenamento indisponível ou corrompido: valores padrão
  }
  const v = raw.voice ?? {};
  const a = raw.appearance ?? {};
  const d = DEFAULT_SETTINGS;
  return {
    voice: {
      inputDeviceId: deviceId(v.inputDeviceId),
      outputDeviceId: deviceId(v.outputDeviceId),
      cameraDeviceId: deviceId(v.cameraDeviceId),
      inputVolume: clamp(v.inputVolume, 0, 2, d.voice.inputVolume),
      outputVolume: clamp(v.outputVolume, 0, 1, d.voice.outputVolume),
      echoCancellation: bool(v.echoCancellation, d.voice.echoCancellation),
      noiseSuppression: bool(v.noiseSuppression, d.voice.noiseSuppression),
      autoGainControl: bool(v.autoGainControl, d.voice.autoGainControl),
    },
    appearance: {
      messageFontSize: Math.round(
        clamp(a.messageFontSize, MESSAGE_FONT_SIZES.min, MESSAGE_FONT_SIZES.max, d.appearance.messageFontSize),
      ),
      compact: bool(a.compact, d.appearance.compact),
    },
  };
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // sem armazenamento, vale só até recarregar
  }
}

/** Restrições do getUserMedia para o microfone escolhido. */
export function microphoneConstraints(prefs: VoicePrefs): MediaTrackConstraints {
  return {
    ...(prefs.inputDeviceId && { deviceId: { exact: prefs.inputDeviceId } }),
    echoCancellation: prefs.echoCancellation,
    noiseSuppression: prefs.noiseSuppression,
    autoGainControl: prefs.autoGainControl,
  };
}

/** Aplica a aparência no documento (variáveis CSS usadas pelas mensagens). */
export function applyAppearance(prefs: AppearancePrefs): void {
  document.documentElement.style.setProperty('--message-font-size', `${prefs.messageFontSize}px`);
}

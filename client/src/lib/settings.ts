// Configurações deste aparelho (navegador ou app de desktop): dispositivos de
// voz e vídeo e aparência. Ficam no localStorage, não no servidor: o microfone
// do notebook não é o mesmo do celular.

import { orderKeys } from './keybinds';

/** Volume de uma pessoa específica, só para você (clique direito nela na chamada). */
export interface UserVolume {
  /** 0 a 2 (1 = 100%). */
  volume: number;
  /** "Silenciar para mim". */
  muted: boolean;
}

export const USER_VOLUME_MAX = 2;
export const DEFAULT_USER_VOLUME: UserVolume = { volume: 1, muted: false };

/** Faixa do medidor e do controle de sensibilidade do microfone, em dB (0 = o mais alto possível). */
export const SENSITIVITY_RANGE = { min: -100, max: 0 } as const;

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
  /** Ligado: o microfone fica sempre aberto. Desligado: só passa o que está acima de `inputSensitivity`. */
  autoSensitivity: boolean;
  /** Nível mínimo (dB) para o microfone abrir, como o controle de sensibilidade do Discord. */
  inputSensitivity: number;
  /** Ajuste de volume por pessoa, pelo id do usuário. */
  userVolumes: Record<string, UserVolume>;
}

export interface AppearancePrefs {
  /** Tamanho do texto das mensagens, em px. */
  messageFontSize: number;
  /** Mensagens em uma linha, sem avatar (como o modo compacto do Discord). */
  compact: boolean;
}

/** Sons da chamada (entrar, sair, mutar...). */
export interface SoundPrefs {
  enabled: boolean;
  /** 0 a 1. */
  volume: number;
}

/**
 * Atalhos de teclado: as teclas seguradas ao mesmo tempo (ver keybinds.ts), por exemplo
 * `['Shift', 'KeyV']`. `null` = sem atalho.
 */
export interface Keybinds {
  mute: string[] | null;
  deafen: string[] | null;
}

export interface Settings {
  voice: VoicePrefs;
  appearance: AppearancePrefs;
  sounds: SoundPrefs;
  keybinds: Keybinds;
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
    autoSensitivity: true,
    inputSensitivity: -50,
    userVolumes: {},
  },
  appearance: { messageFontSize: 15, compact: false },
  sounds: { enabled: true, volume: 0.5 },
  keybinds: { mute: null, deafen: null },
};

const STORAGE_KEY = 'coreto.settings';

const clamp = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);
const deviceId = (value: unknown) => (typeof value === 'string' && value ? value : null);

const MAX_KEYBIND_KEYS = 4;

/** Uma combinação válida: de 1 a 4 códigos de tecla, sem repetição, em ordem fixa. */
export function sanitizeKeybind(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const keys = [...new Set(value.filter((k): k is string => typeof k === 'string' && k.length > 0 && k.length <= 24))];
  return keys.length > 0 && keys.length <= MAX_KEYBIND_KEYS ? orderKeys(keys) : null;
}

function userVolumes(value: unknown): Record<string, UserVolume> {
  const result: Record<string, UserVolume> = {};
  if (!value || typeof value !== 'object') return result;
  for (const [id, entry] of Object.entries(value)) {
    const e = entry as Partial<UserVolume> | null;
    const volume = clamp(e?.volume, 0, USER_VOLUME_MAX, 1);
    const muted = bool(e?.muted, false);
    // Só guarda o que difere do padrão, para a lista não crescer à toa.
    if (volume !== 1 || muted) result[id] = { volume, muted };
  }
  return result;
}

/** Lê o que foi guardado, descartando valores fora do esperado (versões antigas, edição manual). */
export function loadSettings(): Settings {
  let raw: Partial<{
    voice: Partial<VoicePrefs>;
    appearance: Partial<AppearancePrefs>;
    sounds: Partial<SoundPrefs>;
    keybinds: Partial<Keybinds>;
  }> = {};
  try {
    raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') ?? {};
  } catch {
    // armazenamento indisponível ou corrompido: valores padrão
  }
  const v = raw.voice ?? {};
  const a = raw.appearance ?? {};
  const so = raw.sounds ?? {};
  const k = raw.keybinds ?? {};
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
      autoSensitivity: bool(v.autoSensitivity, d.voice.autoSensitivity),
      inputSensitivity: Math.round(
        clamp(v.inputSensitivity, SENSITIVITY_RANGE.min, SENSITIVITY_RANGE.max, d.voice.inputSensitivity),
      ),
      userVolumes: userVolumes(v.userVolumes),
    },
    appearance: {
      messageFontSize: Math.round(
        clamp(a.messageFontSize, MESSAGE_FONT_SIZES.min, MESSAGE_FONT_SIZES.max, d.appearance.messageFontSize),
      ),
      compact: bool(a.compact, d.appearance.compact),
    },
    sounds: { enabled: bool(so.enabled, d.sounds.enabled), volume: clamp(so.volume, 0, 1, d.sounds.volume) },
    keybinds: { mute: sanitizeKeybind(k.mute), deafen: sanitizeKeybind(k.deafen) },
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

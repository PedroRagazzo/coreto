// Atalhos de teclado: uma combinação é o conjunto de teclas seguradas ao mesmo tempo
// ("V", "Shift + V", "Ctrl + Alt + M"...). As teclas são guardadas pelo `code` do
// teclado (a posição física), então valem em qualquer layout.
//
// Shift, Ctrl, Alt e Win valem pelos dois lados do teclado: guardamos só "Shift",
// "Ctrl", "Alt" e "Meta".

export type KeybindAction = 'mute' | 'deafen';

const MODIFIERS = ['Ctrl', 'Alt', 'Shift', 'Meta'] as const;

/** Nome guardado de uma tecla: modificadores sem esquerda/direita, o resto pelo `code`. */
export function keyOf(event: { code: string }): string {
  const { code } = event;
  if (code.startsWith('Shift')) return 'Shift';
  if (code.startsWith('Control')) return 'Ctrl';
  if (code.startsWith('Alt')) return 'Alt';
  if (code.startsWith('Meta') || code === 'OS') return 'Meta';
  return code;
}

export const isModifier = (key: string) => (MODIFIERS as readonly string[]).includes(key);

/** Modificadores primeiro (Ctrl, Alt, Shift, Win), depois as demais teclas em ordem alfabética. */
export function orderKeys(keys: Iterable<string>): string[] {
  const set = new Set(keys);
  return [...MODIFIERS.filter((m) => set.has(m)), ...[...set].filter((k) => !isModifier(k)).sort()];
}

export function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key) => b.includes(key));
}

const SPECIAL_NAMES: Record<string, string> = {
  Meta: 'Win',
  Space: 'Espaço',
  Enter: 'Enter',
  Escape: 'Esc',
  Backspace: 'Backspace',
  Tab: 'Tab',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'Page Up',
  PageDown: 'Page Down',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Minus: '-',
  Equal: '=',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  IntlBackslash: '\\',
  CapsLock: 'Caps Lock',
  NumpadAdd: 'Num +',
  NumpadSubtract: 'Num -',
  NumpadMultiply: 'Num *',
  NumpadDivide: 'Num /',
  NumpadDecimal: 'Num .',
  NumpadEnter: 'Num Enter',
};

export function keyLabel(key: string): string {
  if (SPECIAL_NAMES[key]) return SPECIAL_NAMES[key];
  if (/^Key[A-Z]$/.test(key)) return key.slice(3);
  if (/^Digit\d$/.test(key)) return key.slice(5);
  if (/^Numpad\d$/.test(key)) return `Num ${key.slice(6)}`;
  return key; // F1..F24, Pause, PrintScreen...
}

/** "Shift + V", pronto para mostrar. */
export function formatKeybind(keys: readonly string[]): string {
  return orderKeys(keys).map(keyLabel).join(' + ');
}

/** Combinação válida para atalho: precisa de pelo menos uma tecla que não seja só modificador. */
export const isUsableKeybind = (keys: readonly string[]) => keys.some((k) => !isModifier(k));

/**
 * Acompanha as teclas seguradas agora. O navegador não avisa quando a janela perde o
 * foco com uma tecla pressionada, por isso `clear()` deve ser chamado no `blur`.
 */
export class KeyTracker {
  private readonly down = new Set<string>();

  press(event: { code: string }): string[] {
    this.down.add(keyOf(event));
    return this.keys();
  }

  release(event: { code: string }): string[] {
    this.down.delete(keyOf(event));
    return this.keys();
  }

  clear(): void {
    this.down.clear();
  }

  keys(): string[] {
    return orderKeys(this.down);
  }
}

/** Com algum desses, o atalho pode ser acionado mesmo digitando (não conflita com o texto). */
export const hasCommandModifier = (keys: readonly string[]) => keys.some((k) => k === 'Ctrl' || k === 'Alt' || k === 'Meta');

// ── Atalhos que valem com um jogo em primeiro plano (leitor de teclado nativo do app de desktop) ──
//
// O app de desktop tem um programa (coreto-keys.exe) que recebe as teclas de qualquer programa em foco e avisa
// quando uma combinação é apertada. Ele identifica as teclas pelo código de varredura (scan code) do teclado, a
// posição física, como o `code` do navegador. Aqui está a tradução de um para o outro.

/** Código de varredura de cada tecla (Set 1, em hexadecimal); `E0xx` são as teclas estendidas. */
const SCAN_CODES: Record<string, string> = {
  Escape: '01', Digit1: '02', Digit2: '03', Digit3: '04', Digit4: '05', Digit5: '06', Digit6: '07', Digit7: '08',
  Digit8: '09', Digit9: '0A', Digit0: '0B', Minus: '0C', Equal: '0D', Backspace: '0E', Tab: '0F',
  KeyQ: '10', KeyW: '11', KeyE: '12', KeyR: '13', KeyT: '14', KeyY: '15', KeyU: '16', KeyI: '17', KeyO: '18',
  KeyP: '19', BracketLeft: '1A', BracketRight: '1B', Enter: '1C',
  KeyA: '1E', KeyS: '1F', KeyD: '20', KeyF: '21', KeyG: '22', KeyH: '23', KeyJ: '24', KeyK: '25', KeyL: '26',
  Semicolon: '27', Quote: '28', Backquote: '29', Backslash: '2B',
  KeyZ: '2C', KeyX: '2D', KeyC: '2E', KeyV: '2F', KeyB: '30', KeyN: '31', KeyM: '32', Comma: '33', Period: '34',
  Slash: '35', NumpadMultiply: '37', Space: '39', CapsLock: '3A',
  F1: '3B', F2: '3C', F3: '3D', F4: '3E', F5: '3F', F6: '40', F7: '41', F8: '42', F9: '43', F10: '44',
  NumLock: '45', ScrollLock: '46',
  Numpad7: '47', Numpad8: '48', Numpad9: '49', NumpadSubtract: '4A', Numpad4: '4B', Numpad5: '4C', Numpad6: '4D',
  NumpadAdd: '4E', Numpad1: '4F', Numpad2: '50', Numpad3: '51', Numpad0: '52', NumpadDecimal: '53',
  IntlBackslash: '56', F11: '57', F12: '58',
  F13: '64', F14: '65', F15: '66', F16: '67', F17: '68', F18: '69', F19: '6A', F20: '6B', F21: '6C', F22: '6D',
  F23: '6E', F24: '76',
  NumpadEnter: 'E01C', NumpadDivide: 'E035', Home: 'E047', ArrowUp: 'E048', PageUp: 'E049', ArrowLeft: 'E04B',
  ArrowRight: 'E04D', End: 'E04F', ArrowDown: 'E050', PageDown: 'E051', Insert: 'E052', Delete: 'E053',
};

/** Os dois lados do teclado valem para cada modificador. */
const MODIFIER_SCAN_CODES: Record<string, string> = {
  Ctrl: '1D|E01D',
  Shift: '2A|36',
  Alt: '38|E038',
  Meta: 'E05B|E05C',
};

/**
 * A combinação no formato do leitor de teclado nativo ("1D|E01D+2A|36+2F" para Ctrl + Shift + V): teclas separadas
 * por "+", e cada tecla é a lista de códigos que a representam, separados por "|". `null` se alguma tecla não tem
 * código conhecido (Pause, Print Screen...), e então o atalho só vale com o Coreto em foco.
 */
export function toScanSpec(keys: readonly string[] | null): string | null {
  if (!keys || keys.length === 0 || keys.length > 8) return null;
  const parts: string[] = [];
  for (const key of orderKeys(keys)) {
    const spec = MODIFIER_SCAN_CODES[key] ?? SCAN_CODES[key];
    if (!spec) return null;
    parts.push(spec);
  }
  return parts.join('+');
}

// ── Atalhos globais do app de desktop (Electron `globalShortcut`) ────────────

const ELECTRON_KEYS: Record<string, string> = {
  Space: 'Space',
  Enter: 'Return',
  NumpadEnter: 'Return',
  Escape: 'Esc',
  Backspace: 'Backspace',
  Tab: 'Tab',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Minus: '-',
  Equal: '=',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  NumpadAdd: 'numadd',
  NumpadSubtract: 'numsub',
  NumpadMultiply: 'nummult',
  NumpadDivide: 'numdiv',
  NumpadDecimal: 'numdec',
};

const ELECTRON_MODIFIERS: Record<string, string> = { Ctrl: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Meta: 'Super' };

/**
 * Converte para o formato do Electron, ou `null` se não dá para valer em todo o sistema:
 * precisa de um modificador (uma tecla sozinha, como "V", pararia de funcionar em todos
 * os outros programas) e de exatamente uma tecla comum.
 */
export function toGlobalAccelerator(keys: readonly string[] | null): string | null {
  if (!keys) return null;
  const modifiers = keys.filter(isModifier);
  const others = keys.filter((k) => !isModifier(k));
  if (modifiers.length === 0 || others.length !== 1) return null;
  const [key] = others;
  const name = /^Key[A-Z]$/.test(key)
    ? key.slice(3)
    : /^Digit\d$/.test(key)
      ? key.slice(5)
      : /^F\d{1,2}$/.test(key)
        ? key
        : /^Numpad\d$/.test(key)
          ? `num${key.slice(6)}`
          : ELECTRON_KEYS[key];
  if (!name) return null;
  return [...orderKeys(modifiers).map((m) => ELECTRON_MODIFIERS[m]), name].join('+');
}

import { describe, expect, it } from 'vitest';
import {
  formatKeybind,
  hasCommandModifier,
  isUsableKeybind,
  keyOf,
  KeyTracker,
  orderKeys,
  sameKeys,
  toGlobalAccelerator,
  toScanSpec,
} from '../../../shared/src/keybinds.js';

const press = (tracker: KeyTracker, ...codes: string[]) => codes.forEach((code) => tracker.press({ code }));

describe('teclas', () => {
  it('não distingue o lado dos modificadores', () => {
    expect(keyOf({ code: 'ShiftLeft' })).toBe('Shift');
    expect(keyOf({ code: 'ShiftRight' })).toBe('Shift');
    expect(keyOf({ code: 'ControlRight' })).toBe('Ctrl');
    expect(keyOf({ code: 'AltLeft' })).toBe('Alt');
    expect(keyOf({ code: 'MetaLeft' })).toBe('Meta');
    expect(keyOf({ code: 'KeyV' })).toBe('KeyV');
  });

  it('põe os modificadores primeiro, sempre na mesma ordem', () => {
    expect(orderKeys(['KeyV', 'Shift', 'Ctrl'])).toEqual(['Ctrl', 'Shift', 'KeyV']);
    expect(orderKeys(['Meta', 'KeyB', 'KeyA', 'Alt'])).toEqual(['Alt', 'Meta', 'KeyA', 'KeyB']);
  });

  it('compara combinações sem ligar para a ordem', () => {
    expect(sameKeys(['Shift', 'KeyV'], ['KeyV', 'Shift'])).toBe(true);
    expect(sameKeys(['KeyV'], ['Shift', 'KeyV'])).toBe(false);
    expect(sameKeys(['KeyV'], ['KeyB'])).toBe(false);
  });

  it('mostra a combinação de forma legível', () => {
    expect(formatKeybind(['KeyV'])).toBe('V');
    expect(formatKeybind(['KeyV', 'Shift'])).toBe('Shift + V');
    expect(formatKeybind(['Digit1', 'Ctrl', 'Alt'])).toBe('Ctrl + Alt + 1');
    expect(formatKeybind(['Meta', 'F9'])).toBe('Win + F9');
    expect(formatKeybind(['Space'])).toBe('Espaço');
    expect(formatKeybind(['Numpad5'])).toBe('Num 5');
  });

  it('só aceita combinação com uma tecla que não seja modificador', () => {
    expect(isUsableKeybind(['KeyV'])).toBe(true);
    expect(isUsableKeybind(['Shift', 'KeyV'])).toBe(true);
    expect(isUsableKeybind(['Shift'])).toBe(false);
    expect(isUsableKeybind(['Ctrl', 'Alt'])).toBe(false);
  });

  it('só deixa disparar digitando quando há Ctrl, Alt ou Win', () => {
    expect(hasCommandModifier(['KeyV'])).toBe(false);
    expect(hasCommandModifier(['Shift', 'KeyV'])).toBe(false);
    expect(hasCommandModifier(['Ctrl', 'KeyM'])).toBe(true);
    expect(hasCommandModifier(['Alt', 'Shift', 'KeyM'])).toBe(true);
  });
});

describe('KeyTracker', () => {
  it('sabe o que está segurado e o que foi solto', () => {
    const tracker = new KeyTracker();
    press(tracker, 'ShiftLeft', 'KeyV');
    expect(tracker.keys()).toEqual(['Shift', 'KeyV']);
    expect(tracker.release({ code: 'KeyV' })).toEqual(['Shift']);
    expect(tracker.release({ code: 'ShiftLeft' })).toEqual([]);
  });

  it('Shift + V não dispara o atalho "V" sozinho, e "V" sozinho não dispara Shift + V', () => {
    const plain = ['KeyV'];
    const shifted = ['Shift', 'KeyV'];
    const tracker = new KeyTracker();

    press(tracker, 'ShiftLeft', 'KeyV');
    expect(sameKeys(tracker.keys(), shifted)).toBe(true);
    expect(sameKeys(tracker.keys(), plain)).toBe(false);

    tracker.clear();
    press(tracker, 'KeyV');
    expect(sameKeys(tracker.keys(), plain)).toBe(true);
    expect(sameKeys(tracker.keys(), shifted)).toBe(false);
  });

  it('esquece tudo quando a janela perde o foco', () => {
    const tracker = new KeyTracker();
    press(tracker, 'ControlLeft', 'KeyM');
    tracker.clear();
    expect(tracker.keys()).toEqual([]);
  });
});

describe('toScanSpec', () => {
  it('traduz uma tecla sozinha para o código de varredura', () => {
    expect(toScanSpec(['KeyV'])).toBe('2F');
    expect(toScanSpec(['F13'])).toBe('64');
    expect(toScanSpec(['Space'])).toBe('39');
    expect(toScanSpec(['Digit0'])).toBe('0B');
    expect(toScanSpec(['Numpad5'])).toBe('4C');
  });

  it('as teclas estendidas levam o prefixo E0', () => {
    expect(toScanSpec(['ArrowUp'])).toBe('E048');
    expect(toScanSpec(['NumpadEnter'])).toBe('E01C');
    expect(toScanSpec(['Delete'])).toBe('E053');
  });

  it('um modificador vale pelos dois lados do teclado, e a ordem é a de sempre', () => {
    expect(toScanSpec(['KeyV', 'Shift', 'Ctrl'])).toBe('1D|E01D+2A|36+2F');
    expect(toScanSpec(['Meta', 'KeyM'])).toBe('E05B|E05C+32');
    expect(toScanSpec(['Alt', 'F9'])).toBe('38|E038+43');
  });

  it('serve para combinações que o Electron não aceita como atalho global (sem modificador, várias teclas)', () => {
    expect(toGlobalAccelerator(['KeyV'])).toBeNull();
    expect(toScanSpec(['KeyV'])).toBe('2F');
    expect(toGlobalAccelerator(['KeyA', 'KeyB'])).toBeNull();
    expect(toScanSpec(['KeyA', 'KeyB'])).toBe('1E+30');
  });

  it('recusa o que não tem código conhecido, ou não é uma combinação', () => {
    expect(toScanSpec(['Pause'])).toBeNull();
    expect(toScanSpec(['PrintScreen'])).toBeNull();
    expect(toScanSpec(['Ctrl', 'Pause'])).toBeNull();
    expect(toScanSpec(null)).toBeNull();
    expect(toScanSpec([])).toBeNull();
  });

  it('todo código gerado é aceito pelo leitor: hexadecimal de 2 a 4 dígitos, separadores + e |', () => {
    const format = /^[0-9A-F]{2,4}(\|[0-9A-F]{2,4})*(\+[0-9A-F]{2,4}(\|[0-9A-F]{2,4})*)*$/;
    for (const code of ['KeyA', 'Digit5', 'F1', 'F24', 'Numpad0', 'NumpadEnter', 'Insert', 'Backquote', 'IntlBackslash']) {
      expect(toScanSpec(['Ctrl', code])).toMatch(format);
    }
  });
});

describe('toGlobalAccelerator', () => {
  it('converte modificador + tecla para o formato do Electron', () => {
    expect(toGlobalAccelerator(['Ctrl', 'Shift', 'KeyM'])).toBe('Ctrl+Shift+M');
    expect(toGlobalAccelerator(['Alt', 'Digit5'])).toBe('Alt+5');
    expect(toGlobalAccelerator(['Ctrl', 'Alt', 'Shift', 'F9'])).toBe('Ctrl+Alt+Shift+F9');
    expect(toGlobalAccelerator(['Meta', 'ArrowUp'])).toBe('Super+Up');
    expect(toGlobalAccelerator(['Ctrl', 'Numpad3'])).toBe('Ctrl+num3');
    expect(toGlobalAccelerator(['Ctrl', 'Backquote'])).toBe('Ctrl+`');
  });

  it('recusa o que não pode valer no sistema todo', () => {
    // Uma tecla sozinha (ou só com Shift) pararia de funcionar em todos os outros programas.
    expect(toGlobalAccelerator(['KeyV'])).toBeNull();
    expect(toGlobalAccelerator(['F9'])).toBeNull();
    // Duas teclas comuns: o Electron só aceita uma.
    expect(toGlobalAccelerator(['Ctrl', 'KeyA', 'KeyB'])).toBeNull();
    expect(toGlobalAccelerator(['Ctrl'])).toBeNull();
    expect(toGlobalAccelerator(['Ctrl', 'MediaPlayPause'])).toBeNull();
    expect(toGlobalAccelerator(null)).toBeNull();
  });
});

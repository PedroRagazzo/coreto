import { Keyboard, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { desktop } from '../../lib/desktop';
import {
  formatKeybind,
  isUsableKeybind,
  keybindRecording,
  KeyTracker,
  keyOf,
  orderKeys,
  sameKeys,
  toGlobalAccelerator,
  type KeybindAction,
} from '../../lib/keybinds';
import { useSettings } from '../../state/settings';
import { useGlobalShortcutStatus, type GlobalStatus } from '../VoiceEffects';
import { SettingsGroup } from './SettingsModal';

const MAX_KEYS = 4;

const ROWS: { action: KeybindAction; label: string; description: string }[] = [
  { action: 'mute', label: 'Ativar/desativar microfone', description: 'Liga e desliga o seu microfone na chamada.' },
  {
    action: 'deafen',
    label: 'Ativar/desativar som',
    description: 'Liga e desliga o som da chamada (desativar o som também muta o microfone).',
  },
];

export function ShortcutSettings() {
  const { settings, update } = useSettings();
  const status = useGlobalShortcutStatus();
  const [message, setMessage] = useState<string | null>(null);
  const keybinds = settings.keybinds;
  const canGlobal = Boolean(desktop?.setGlobalShortcuts);

  const setBind = (action: KeybindAction, keys: string[] | null) => {
    const other = keybinds[action === 'mute' ? 'deafen' : 'mute'];
    if (keys && other && sameKeys(keys, other)) {
      setMessage('Essa combinação já está em uso pelo outro atalho.');
      return;
    }
    setMessage(null);
    update((s) => ({ ...s, keybinds: { ...s.keybinds, [action]: keys } }));
  };

  return (
    <SettingsGroup
      title="Atalhos de teclado"
      hint="Clique em Gravar e aperte a tecla ou as teclas juntas, como V ou Shift + V. Os atalhos só funcionam durante uma chamada."
    >
      {ROWS.map(({ action, label, description }) => (
        <KeybindRow
          key={action}
          label={label}
          description={description}
          keys={keybinds[action]}
          global={canGlobal ? status[action] : null}
          onChange={(keys) => setBind(action, keys)}
        />
      ))}
      {message && (
        <p role="alert" className="mt-2 text-sm text-dnd">
          {message}
        </p>
      )}
      <p className="mt-4 text-xs text-faint">
        {canGlobal
          ? 'No app de desktop, combinações com Ctrl, Alt, Shift ou Win também funcionam com o Coreto em segundo plano, por exemplo jogando. Uma tecla sozinha, como V, só funciona com o Coreto em foco.'
          : 'No navegador, os atalhos só funcionam com a aba do Coreto em foco. No app de desktop, combinações com Ctrl, Alt, Shift ou Win funcionam também em segundo plano.'}
      </p>
    </SettingsGroup>
  );
}

function globalNote(keys: string[], global: GlobalStatus | null): string | null {
  if (global === null) return null;
  if (global === 'active') return 'Vale também com o Coreto em segundo plano.';
  if (global === 'taken') return 'Outro programa já usa esta combinação: ela só vale com o Coreto em foco.';
  return toGlobalAccelerator(keys)
    ? null
    : 'Só vale com o Coreto em foco. Para valer fora dele, use um modificador (Ctrl, Alt, Shift ou Win) mais uma tecla.';
}

function KeybindRow({
  label,
  description,
  keys,
  global,
  onChange,
}: {
  label: string;
  description: string;
  keys: string[] | null;
  global: GlobalStatus | null;
  onChange: (keys: string[] | null) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [held, setHeld] = useState<string[]>([]);
  const [hint, setHint] = useState<string | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!recording) return;
    keybindRecording.active = true;
    const tracker = new KeyTracker();
    // Tudo que foi segurado desde a primeira tecla; vale quando todas são soltas.
    const combo = new Set<string>();
    const finish = () => {
      const result = orderKeys(combo);
      setRecording(false);
      if (result.length === 0) return;
      if (result.length === 1 && result[0] === 'Escape') return; // Esc cancela
      if (!isUsableKeybind(result)) setHint('Use também uma tecla comum, não só Shift, Ctrl, Alt ou Win.');
      else if (result.length > MAX_KEYS) setHint(`No máximo ${MAX_KEYS} teclas juntas.`);
      else {
        setHint(null);
        onChangeRef.current(result);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      // Enquanto grava, nenhuma tecla faz o que faria normalmente (Tab, Esc, F5...).
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      tracker.press(event);
      combo.add(keyOf(event));
      setHeld(orderKeys(combo));
    };
    const onKeyUp = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (tracker.release(event).length === 0) finish();
    };
    const cancel = () => setRecording(false);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', cancel);
    return () => {
      keybindRecording.active = false;
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', cancel);
      setHeld([]);
    };
  }, [recording]);

  const shown = recording
    ? held.length
      ? formatKeybind(held)
      : 'Aperte as teclas…'
    : keys
      ? formatKeybind(keys)
      : 'Sem atalho';
  const note = !recording && keys ? globalNote(keys, global) : null;

  return (
    <div className="border-b border-line py-3 first:pt-0 last:border-0">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1 basis-56">
          <p className="font-medium">{label}</p>
          <p className="text-sm text-faint">{description}</p>
        </div>
        <span
          aria-live="polite"
          className={`flex w-48 shrink-0 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-semibold ${
            recording ? 'bg-accent/20 text-accent ring-2 ring-accent' : keys ? 'bg-rail text-fg' : 'bg-rail text-faint'
          }`}
        >
          <Keyboard size={16} aria-hidden />
          {shown}
        </span>
        <button
          type="button"
          onClick={() => {
            setHint(null);
            setRecording((r) => !r);
          }}
          className="rounded-md bg-elevated px-3 py-2 text-sm font-semibold hover:bg-hover"
        >
          {recording ? 'Cancelar' : keys ? 'Mudar' : 'Gravar'}
        </button>
        {keys && !recording && (
          <button
            type="button"
            aria-label={`Remover o atalho de ${label}`}
            title="Remover atalho"
            onClick={() => onChange(null)}
            className="rounded-md p-2 text-muted hover:bg-hover hover:text-fg"
          >
            <X size={16} />
          </button>
        )}
      </div>
      {hint && (
        <p role="alert" className="mt-2 text-sm text-dnd">
          {hint}
        </p>
      )}
      {note && <p className="mt-2 text-xs text-faint">{note}</p>}
    </div>
  );
}

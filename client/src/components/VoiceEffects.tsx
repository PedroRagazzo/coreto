import { soundsForChange, type CallSnapshot } from '@shared/call-sounds';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { desktop } from '../lib/desktop';
import {
  hasCommandModifier,
  isTypingTarget,
  keybindRecording,
  KeyTracker,
  sameKeys,
  toGlobalAccelerator,
  type KeybindAction,
} from '../lib/keybinds';
import { playSound } from '../lib/sounds';
import { useRealtime } from '../state/realtime';
import { useSettings } from '../state/settings';

const JOIN_SETTLE_MS = 1_500;

/**
 * Sons da chamada: você entra ou sai, alguém entra ou sai, alguém começa ou para de
 * assistir à transmissão que você faz ou assiste, e você muta ou ensurdece. Não desenha nada.
 */
export function CallSounds() {
  const { state } = useRealtime();
  const { settings } = useSettings();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const { channelId, muted, deafened } = state.myVoice;
  const me = state.me?.id ?? null;
  const room = channelId ? state.voice[channelId] : undefined;
  const joinedAt = useRef(0);
  const previous = useRef<CallSnapshot | null>(null);

  useEffect(() => {
    const now: CallSnapshot = {
      channelId,
      room: new Map((room ?? []).map((p) => [p.userId, p] as const)),
      muted,
      deafened,
    };
    const before = previous.current;
    previous.current = now;
    if (!before) return;
    if (now.channelId !== before.channelId) joinedAt.current = Date.now();

    const { sounds: prefs, voice } = settingsRef.current;
    if (!prefs.enabled) return;
    const settled = Date.now() - joinedAt.current > JOIN_SETTLE_MS;
    for (const kind of soundsForChange(before, now, me, settled)) {
      playSound(kind, { volume: prefs.volume, outputDeviceId: voice.outputDeviceId });
    }
  }, [channelId, room, muted, deafened, me]);

  return null;
}

// ── Atalhos de teclado ───────────────────────────────────────────────────────

/** Como cada atalho está valendo no app de desktop. */
export type GlobalStatus = 'off' | 'active' | 'taken';

let globalStatus: Record<KeybindAction, GlobalStatus> = { mute: 'off', deafen: 'off' };
const listeners = new Set<() => void>();
const setGlobalStatus = (next: Record<KeybindAction, GlobalStatus>) => {
  globalStatus = next;
  listeners.forEach((l) => l());
};

/** No app de desktop: o atalho vale com o Coreto em segundo plano ("active"), ou outro programa já o usa ("taken"). */
export function useGlobalShortcutStatus(): Record<KeybindAction, GlobalStatus> {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => globalStatus,
  );
}

/**
 * Atalhos para mutar o microfone e o som. Na janela valem para qualquer combinação; no app
 * de desktop, as que têm Ctrl, Alt, Shift ou Win também valem com o Coreto em segundo plano.
 */
export function Shortcuts() {
  const { actions } = useRealtime();
  const { settings } = useSettings();
  const { mute, deafen } = settings.keybinds;
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  const run = useRef((action: KeybindAction) => {
    if (action === 'mute') actionsRef.current.toggleMute();
    else actionsRef.current.toggleDeafen();
  });

  // Na janela do Coreto.
  useEffect(() => {
    const tracker = new KeyTracker();
    const binds: [KeybindAction, string[] | null][] = [
      ['mute', mute],
      ['deafen', deafen],
    ];
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || keybindRecording.active) return;
      const keys = tracker.press(event);
      if (event.repeat) return;
      for (const [action, bind] of binds) {
        // Se o atalho já vale no sistema inteiro, o Windows o entrega pelo app: não dispare duas vezes.
        if (!bind || globalStatus[action] === 'active' || !sameKeys(keys, bind)) continue;
        // Digitando, uma tecla sozinha (ou com Shift) é texto, não atalho.
        if (isTypingTarget(event.target) && !hasCommandModifier(bind)) continue;
        event.preventDefault();
        run.current(action);
        return;
      }
    };
    const onKeyUp = (event: KeyboardEvent) => void tracker.release(event);
    const onBlur = () => tracker.clear();
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [mute, deafen]);

  // No sistema inteiro (só no app de desktop, e só com um modificador na combinação).
  useEffect(() => {
    if (!desktop?.setGlobalShortcuts) return;
    const accelerators = { mute: toGlobalAccelerator(mute), deafen: toGlobalAccelerator(deafen) };
    let current = true;
    void desktop.setGlobalShortcuts(accelerators).then((result) => {
      if (!current) return;
      const status = (action: KeybindAction): GlobalStatus =>
        !accelerators[action] ? 'off' : result?.[action] ? 'active' : 'taken';
      setGlobalStatus({ mute: status('mute'), deafen: status('deafen') });
    });
    const stop = desktop.onShortcut?.((action) => run.current(action));
    return () => {
      current = false;
      stop?.();
    };
  }, [mute, deafen]);

  return null;
}

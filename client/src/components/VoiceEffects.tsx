import { soundsForChange, type CallSnapshot } from '@shared/call-sounds';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { desktop, type KeyBindMode } from '../lib/desktop';
import {
  hasCommandModifier,
  isTypingTarget,
  keybindRecording,
  KeyTracker,
  sameKeys,
  toGlobalAccelerator,
  toScanSpec,
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

/**
 * Como cada atalho está valendo no app de desktop: `game` em qualquer programa (inclusive um jogo em tela cheia),
 * `active` com o Coreto em segundo plano, `taken` outro programa já usa a combinação, `off` só com o Coreto em foco.
 */
export type GlobalStatus = 'off' | 'active' | 'game' | 'taken';

/** O atalho vale fora do Coreto (e então o Windows ou o leitor de teclado o entregam pelo app, não a janela)? */
const isGlobal = (status: GlobalStatus) => status === 'active' || status === 'game';

const statusOf = (mode: KeyBindMode | undefined): GlobalStatus =>
  mode === 'watcher' ? 'game' : mode === 'hotkey' ? 'active' : mode === 'taken' ? 'taken' : 'off';

let globalStatus: Record<KeybindAction, GlobalStatus> = { mute: 'off', deafen: 'off' };
const listeners = new Set<() => void>();
const setGlobalStatus = (next: Record<KeybindAction, GlobalStatus>) => {
  globalStatus = next;
  listeners.forEach((l) => l());
};

/** No app de desktop: como cada atalho vale fora do Coreto (ver `GlobalStatus`). */
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
 * Atalhos para mutar o microfone e o som. Na janela valem para qualquer combinação. No app de desktop, qualquer
 * combinação (até uma tecla sozinha) vale em qualquer programa, inclusive um jogo em tela cheia; no app antigo, só as
 * que têm Ctrl, Alt, Shift ou Win valem com o Coreto em segundo plano.
 */
export function Shortcuts() {
  const { actions } = useRealtime();
  const { settings } = useSettings();
  const { mute, deafen } = settings.keybinds;
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const bindsRef = useRef({ mute, deafen });
  bindsRef.current = { mute, deafen };

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
        if (!bind || isGlobal(globalStatus[action]) || !sameKeys(keys, bind)) continue;
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

  // Fora da janela (só no app de desktop).
  useEffect(() => {
    if (!desktop?.setKeyBinds && !desktop?.setGlobalShortcuts) return;
    const accelerators = { mute: toGlobalAccelerator(mute), deafen: toGlobalAccelerator(deafen) };
    let current = true;
    if (desktop.setKeyBinds) {
      // App novo: o leitor de teclado vigia qualquer combinação, e o atalho do Windows fica de reserva.
      void desktop
        .setKeyBinds({
          mute: { spec: toScanSpec(mute), accelerator: accelerators.mute },
          deafen: { spec: toScanSpec(deafen), accelerator: accelerators.deafen },
        })
        .then((result) => {
          if (current) setGlobalStatus({ mute: statusOf(result?.mute), deafen: statusOf(result?.deafen) });
        });
    } else {
      // App antigo: só atalho do Windows, e só com um modificador na combinação.
      void desktop.setGlobalShortcuts?.(accelerators).then((result) => {
        if (!current) return;
        const status = (action: KeybindAction): GlobalStatus =>
          !accelerators[action] ? 'off' : result?.[action] ? 'active' : 'taken';
        setGlobalStatus({ mute: status('mute'), deafen: status('deafen') });
      });
    }
    const stop = desktop.onShortcut?.((action) => {
      if (keybindRecording.active) return;
      // Com o Coreto em foco e você digitando, uma tecla sozinha (ou com Shift) é texto, não atalho: a mesma regra da janela.
      const bind = bindsRef.current[action];
      if (document.hasFocus() && isTypingTarget(document.activeElement) && bind && !hasCommandModifier(bind)) return;
      run.current(action);
    });
    return () => {
      current = false;
      stop?.();
    };
  }, [mute, deafen]);

  return null;
}

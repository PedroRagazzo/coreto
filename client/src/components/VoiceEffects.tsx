import { soundsForChange, type CallSnapshot } from '@shared/call-sounds';
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { desktop, type KeyBindMode } from '../lib/desktop';
import {
  hasCommandModifier,
  isTypingTarget,
  keybindRecording,
  KeyTracker,
  MAX_SOUND_BINDS,
  sameKeys,
  soundActionName,
  toGlobalAccelerator,
  toScanSpec,
} from '../lib/keybinds';
import { readSoundboardPrefs } from '../lib/soundboard';
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
const isGlobal = (status: GlobalStatus | undefined) => status === 'active' || status === 'game';

const statusOf = (mode: KeyBindMode | undefined): GlobalStatus =>
  mode === 'watcher' ? 'game' : mode === 'hotkey' ? 'active' : mode === 'taken' ? 'taken' : 'off';

/** Pelo nome do atalho: "mute", "deafen" e "snd0", "snd1"... (os sons do quadro de som). */
let globalStatus: Record<string, GlobalStatus> = { mute: 'off', deafen: 'off' };
const listeners = new Set<() => void>();
const setGlobalStatus = (next: Record<string, GlobalStatus>) => {
  globalStatus = next;
  listeners.forEach((l) => l());
};

/** No app de desktop: como cada atalho vale fora do Coreto (ver `GlobalStatus`). */
export function useGlobalShortcutStatus(): Record<string, GlobalStatus> {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => globalStatus,
  );
}

/** Um atalho valendo agora: mutar, ensurdecer, ou tocar um som do quadro de som (`clipId`). */
interface Bind {
  id: string;
  keys: string[];
  clipId?: string;
}

/**
 * Atalhos para mutar o microfone e o som e para tocar os sons do quadro de som. Na janela valem para qualquer
 * combinação. No app de desktop, qualquer combinação (até uma tecla sozinha) vale em qualquer programa, inclusive um
 * jogo em tela cheia; no app antigo, só as que têm Ctrl, Alt, Shift ou Win valem com o Coreto em segundo plano (e só
 * mutar e ensurdecer; os sons valem só com o Coreto em foco).
 */
export function Shortcuts() {
  const { state, actions } = useRealtime();
  const { settings } = useSettings();
  const { mute, deafen } = settings.keybinds;
  const { soundKeybinds } = settings;
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const stateRef = useRef(state);
  stateRef.current = state;

  // Os sons que têm atalho, dos espaços já carregados, na mesma ordem sempre (o nome "sndN" depende dela).
  const soundBinds = useMemo<Bind[]>(() => {
    const found: Bind[] = [];
    for (const clips of Object.values(state.sounds)) {
      for (const clip of clips) {
        const keys = soundKeybinds[clip.id];
        if (keys) found.push({ id: '', keys, clipId: clip.id });
      }
    }
    found.sort((a, b) => (a.clipId ?? '').localeCompare(b.clipId ?? ''));
    return found.slice(0, MAX_SOUND_BINDS).map((bind, index) => ({ ...bind, id: soundActionName(index) }));
  }, [state.sounds, soundKeybinds]);

  const binds: Bind[] = [
    ...(mute ? [{ id: 'mute', keys: mute }] : []),
    ...(deafen ? [{ id: 'deafen', keys: deafen }] : []),
    ...soundBinds,
  ];
  const bindsKey = binds.map((b) => `${b.id}=${b.keys.join('+')}`).join('|');
  const latest = useRef({ mute, deafen, binds, soundBinds });
  latest.current = { mute, deafen, binds, soundBinds };

  // Os sons só chegam quando o quadro é aberto: com atalhos guardados, carrega os do espaço que está na tela.
  const spaceId = state.snapshot?.space.id;
  const hasSoundBinds = Object.keys(soundKeybinds).length > 0;
  const loaded = spaceId ? state.sounds[spaceId] !== undefined : true;
  useEffect(() => {
    if (hasSoundBinds && spaceId && !loaded) void actions.loadSounds(spaceId);
  }, [actions, hasSoundBinds, spaceId, loaded]);

  const run = useRef((bind: Bind) => {
    if (bind.id === 'mute') return actionsRef.current.toggleMute();
    if (bind.id === 'deafen') return actionsRef.current.toggleDeafen();
    // Um som: só com você numa chamada e ouvindo, como os botões do quadro.
    const { myVoice, sounds } = stateRef.current;
    if (!bind.clipId || !myVoice.channelId || myVoice.deafened) return;
    const clip = Object.values(sounds)
      .flat()
      .find((c) => c.id === bind.clipId);
    if (!clip) return;
    const { volume, hearMine } = readSoundboardPrefs();
    void actionsRef.current.playSound(clip, volume, hearMine ? 0.8 : 0);
  });

  // Na janela do Coreto.
  useEffect(() => {
    const tracker = new KeyTracker();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || keybindRecording.active) return;
      const keys = tracker.press(event);
      if (event.repeat) return;
      for (const bind of latest.current.binds) {
        // Se o atalho já vale no sistema inteiro, o Windows o entrega pelo app: não dispare duas vezes.
        if (isGlobal(globalStatus[bind.id]) || !sameKeys(keys, bind.keys)) continue;
        // Digitando, uma tecla sozinha (ou com Shift) é texto, não atalho.
        if (isTypingTarget(event.target) && !hasCommandModifier(bind.keys)) continue;
        event.preventDefault();
        run.current(bind);
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
  }, [bindsKey]);

  // Fora da janela (só no app de desktop).
  useEffect(() => {
    if (!desktop?.setKeyBinds && !desktop?.setGlobalShortcuts) return;
    const { mute: muteKeys, deafen: deafenKeys, soundBinds: sounds } = latest.current;
    const accelerators = { mute: toGlobalAccelerator(muteKeys), deafen: toGlobalAccelerator(deafenKeys) };
    let current = true;
    if (desktop.setKeyBinds) {
      // App novo: o leitor de teclado vigia qualquer combinação, e o atalho do Windows fica de reserva.
      const request: Record<string, { spec: string | null; accelerator: string | null }> = {
        mute: { spec: toScanSpec(muteKeys), accelerator: accelerators.mute },
        deafen: { spec: toScanSpec(deafenKeys), accelerator: accelerators.deafen },
      };
      for (const bind of sounds) request[bind.id] = { spec: toScanSpec(bind.keys), accelerator: toGlobalAccelerator(bind.keys) };
      void desktop.setKeyBinds(request).then((result) => {
        if (!current) return;
        const next: Record<string, GlobalStatus> = { mute: statusOf(result?.mute), deafen: statusOf(result?.deafen) };
        for (const bind of sounds) next[bind.id] = statusOf(result?.[bind.id]);
        setGlobalStatus(next);
      });
    } else {
      // App antigo: só atalho do Windows, só para mutar e ensurdecer, e só com um modificador na combinação.
      void desktop.setGlobalShortcuts?.(accelerators).then((result) => {
        if (!current) return;
        const status = (action: 'mute' | 'deafen'): GlobalStatus => (!accelerators[action] ? 'off' : result?.[action] ? 'active' : 'taken');
        setGlobalStatus({ mute: status('mute'), deafen: status('deafen') });
      });
    }
    const stop = desktop.onShortcut?.((action) => {
      if (keybindRecording.active) return;
      const bind = latest.current.binds.find((b) => b.id === action);
      if (!bind) return;
      // Com o Coreto em foco e você digitando, uma tecla sozinha (ou com Shift) é texto, não atalho: a mesma regra da janela.
      if (document.hasFocus() && isTypingTarget(document.activeElement) && !hasCommandModifier(bind.keys)) return;
      run.current(bind);
    });
    return () => {
      current = false;
      stop?.();
    };
  }, [bindsKey]);

  return null;
}

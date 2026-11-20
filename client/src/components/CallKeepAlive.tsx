import { useEffect, useRef } from 'react';
import { useRealtime } from '../state/realtime';

/** Aparelhos sem mouse (celular, tablet): é onde a tela apaga e a chamada corre risco. */
const NO_HOVER = '(hover: none)';

type ActionName = MediaSessionAction | 'hangup' | 'togglemicrophone';
interface MicSession {
  setMicrophoneActive?: (active: boolean) => void;
}

/**
 * Ajuda a chamada a durar no celular, sem desenhar nada:
 * - mantém a tela ligada enquanto você está na chamada (o navegador solta isso ao trocar de aba; pedimos de novo ao voltar);
 * - mostra "em chamada" nos controles de mídia do sistema (tela de bloqueio e notificações), com botões de sair e de microfone,
 *   e mantém o som de quem fala tocando no segundo plano.
 */
export function CallKeepAlive() {
  const { state, actions } = useRealtime();
  const { channelId, channelName, muted } = state.myVoice;
  const inCall = Boolean(channelId);
  const latest = useRef(actions);
  latest.current = actions;

  useEffect(() => {
    if (!inCall || !('wakeLock' in navigator) || !window.matchMedia(NO_HOVER).matches) return;
    let lock: WakeLockSentinel | null = null;
    let stopped = false;
    const acquire = async () => {
      if (stopped || document.visibilityState !== 'visible' || (lock && !lock.released)) return;
      try {
        const next = await navigator.wakeLock.request('screen');
        if (stopped) void next.release().catch(() => {});
        else lock = next;
      } catch {
        // sem permissão ou bateria fraca: a chamada segue normal, só a tela pode apagar
      }
    };
    void acquire();
    const onVisible = () => void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release().catch(() => {});
    };
  }, [inCall]);

  useEffect(() => {
    const session = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
    if (!inCall || !session || typeof MediaMetadata === 'undefined') return;
    session.metadata = new MediaMetadata({
      title: channelName ?? 'Chamada',
      artist: 'Coreto — em chamada',
      artwork: [{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' }],
    });
    session.playbackState = 'playing';
    const handlers: [ActionName, () => void][] = [
      ['hangup', () => latest.current.leaveVoice()],
      ['togglemicrophone', () => latest.current.toggleMute()],
    ];
    for (const [action, handler] of handlers) {
      try {
        session.setActionHandler(action as MediaSessionAction, handler);
      } catch {
        // esse navegador não conhece essa ação
      }
    }
    return () => {
      for (const [action] of handlers) {
        try {
          session.setActionHandler(action as MediaSessionAction, null);
        } catch {
          // idem
        }
      }
      session.metadata = null;
      session.playbackState = 'none';
    };
  }, [inCall, channelName]);

  useEffect(() => {
    if (!inCall) return;
    try {
      (navigator.mediaSession as unknown as MicSession | undefined)?.setMicrophoneActive?.(!muted);
    } catch {
      // opcional
    }
  }, [inCall, muted]);

  return null;
}

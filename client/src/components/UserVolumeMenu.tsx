import type { Id } from '@shared/models';
import { Volume2, VolumeX } from 'lucide-react';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { DEFAULT_USER_VOLUME, USER_VOLUME_MAX, type UserVolume } from '../lib/settings';
import { useSettings } from '../state/settings';

interface Target {
  userId: Id;
  name: string;
  x: number;
  y: number;
}

/**
 * Menu do botão direito numa pessoa da chamada: volume só seu (0 a 200%) e
 * "Silenciar para mim", como no Discord. Fica guardado neste aparelho.
 */
export function useUserVolumeMenu() {
  const [target, setTarget] = useState<Target | null>(null);
  const open = (event: MouseEvent, userId: Id, name: string) => {
    event.preventDefault();
    setTarget({ userId, name, x: event.clientX, y: event.clientY });
  };
  const menu = target && <UserVolumeMenu key={target.userId} target={target} onClose={() => setTarget(null)} />;
  return { open, menu };
}

const MENU_WIDTH = 240;
const MENU_HEIGHT = 140;

function UserVolumeMenu({ target, onClose }: { target: Target; onClose: () => void }) {
  const { settings, update } = useSettings();
  const ref = useRef<HTMLDivElement>(null);
  const current = settings.voice.userVolumes[target.userId] ?? DEFAULT_USER_VOLUME;

  useEffect(() => {
    const away = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', away, true);
    document.addEventListener('contextmenu', away, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    ref.current?.querySelector('input')?.focus();
    return () => {
      document.removeEventListener('mousedown', away, true);
      document.removeEventListener('contextmenu', away, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const set = (patch: Partial<UserVolume>) =>
    update((s) => {
      const next = { ...(s.voice.userVolumes[target.userId] ?? DEFAULT_USER_VOLUME), ...patch };
      const { [target.userId]: _old, ...others } = s.voice.userVolumes;
      const isDefault = next.volume === DEFAULT_USER_VOLUME.volume && next.muted === DEFAULT_USER_VOLUME.muted;
      return { ...s, voice: { ...s.voice, userVolumes: isDefault ? others : { ...others, [target.userId]: next } } };
    });

  // Perto da borda, o menu abre para dentro da tela.
  const left = Math.min(target.x, window.innerWidth - MENU_WIDTH - 8);
  const top = Math.min(target.y, window.innerHeight - MENU_HEIGHT - 8);
  const percent = Math.round((current.muted ? 0 : current.volume) * 100);

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={`Volume de ${target.name}`}
      // Eventos de portal sobem pela árvore do React: sem isto, o menu reabriria na linha de baixo.
      onContextMenu={(e) => e.stopPropagation()}
      style={{ left, top, width: MENU_WIDTH }}
      className="fixed z-50 rounded-lg border border-line bg-elevated p-3 shadow-xl"
    >
      <p className="mb-2 truncate text-sm font-semibold">{target.name}</p>
      <label className="block">
        <span className="mb-1 flex justify-between text-xs font-bold tracking-wide text-muted uppercase">
          Volume do usuário
          <span className="font-normal normal-case">{percent}%</span>
        </span>
        <input
          type="range"
          min={0}
          max={USER_VOLUME_MAX}
          step={0.05}
          value={current.muted ? 0 : current.volume}
          // Mexer no volume tira o "silenciar"; levar a 0 equivale a silenciar.
          onChange={(e) => set({ volume: Number(e.target.value), muted: false })}
          className="w-full accent-accent"
        />
      </label>
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={current.muted}
        onClick={() => set({ muted: !current.muted })}
        className="mt-2 flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-hover"
      >
        {current.muted ? <VolumeX size={16} className="text-dnd" /> : <Volume2 size={16} />}
        {current.muted ? 'Tirar o silêncio' : 'Silenciar para mim'}
      </button>
      {(current.muted || current.volume !== 1) && (
        <button
          type="button"
          onClick={() => set(DEFAULT_USER_VOLUME)}
          className="flex w-full items-center rounded px-2 py-1.5 text-sm text-muted hover:bg-hover hover:text-fg"
        >
          Redefinir volume
        </button>
      )}
    </div>,
    document.body,
  );
}

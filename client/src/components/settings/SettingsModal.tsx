import { Keyboard, Monitor, Palette, Settings2, Volume2, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AppearanceSettings } from './AppearanceSettings';
import { DesktopSettings } from './DesktopSettings';
import { ShortcutSettings } from './ShortcutSettings';
import { SoundSettings } from './SoundSettings';
import { VoiceVideoSettings } from './VoiceVideoSettings';

export type SettingsSection = 'voice' | 'sounds' | 'keybinds' | 'appearance' | 'desktop';

const SECTIONS: { id: SettingsSection; label: string; icon: ReactNode; group: string }[] = [
  { id: 'voice', label: 'Voz e vídeo', icon: <Settings2 size={16} />, group: 'Configurações do app' },
  { id: 'sounds', label: 'Sons', icon: <Volume2 size={16} />, group: 'Configurações do app' },
  { id: 'keybinds', label: 'Atalhos', icon: <Keyboard size={16} />, group: 'Configurações do app' },
  { id: 'appearance', label: 'Aparência', icon: <Palette size={16} />, group: 'Configurações do app' },
  { id: 'desktop', label: 'App de desktop', icon: <Monitor size={16} />, group: 'Windows' },
];

/**
 * Configurações em tela cheia, como as Configurações de Usuário do Discord:
 * categorias à esquerda, conteúdo à direita, Esc ou o X para fechar.
 */
export function SettingsModal({ initial = 'voice', onClose }: { initial?: SettingsSection; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [section, setSection] = useState<SettingsSection>(initial);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const groups = [...new Set(SECTIONS.map((s) => s.group))];
  const current = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];

  return (
    <dialog
      ref={ref}
      aria-label="Configurações"
      onClose={onClose}
      className="m-0 h-dvh max-h-none w-screen max-w-none bg-panel p-0 text-fg backdrop:bg-black/60"
    >
      <div className="flex h-full">
        <nav aria-label="Categorias" className="flex w-60 shrink-0 justify-end overflow-y-auto bg-sidebar py-12 pr-2 pl-4">
          <div className="w-48">
            {groups.map((group) => (
              <div key={group} className="mb-4">
                <p className="px-2.5 pb-1 text-[11px] font-bold tracking-wide text-faint uppercase">{group}</p>
                {SECTIONS.filter((s) => s.group === group).map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    aria-current={s.id === section ? 'page' : undefined}
                    onClick={() => setSection(s.id)}
                    className={`mb-0.5 flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-[15px] ${
                      s.id === section ? 'bg-hover text-fg' : 'text-muted hover:bg-hover/60 hover:text-fg'
                    }`}
                  >
                    {s.icon}
                    {s.label}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </nav>

        <main className="relative min-w-0 flex-1 overflow-y-auto">
          <div className="max-w-2xl px-10 py-12">
            <h2 className="mb-6 text-xl font-bold">{current.label}</h2>
            {current.id === 'voice' && <VoiceVideoSettings />}
            {current.id === 'sounds' && <SoundSettings />}
            {current.id === 'keybinds' && <ShortcutSettings />}
            {current.id === 'appearance' && <AppearanceSettings />}
            {current.id === 'desktop' && <DesktopSettings />}
          </div>
          <div className="absolute top-12 right-10 flex flex-col items-center gap-1 text-xs font-semibold text-faint">
            <button
              type="button"
              onClick={() => ref.current?.close()}
              aria-label="Fechar configurações"
              className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-faint text-muted hover:border-fg hover:text-fg"
            >
              <X size={18} />
            </button>
            ESC
          </div>
        </main>
      </div>
    </dialog>
  );
}

/** Título e texto de ajuda de um bloco de configurações. */
export function SettingsGroup({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="mb-8 border-b border-line pb-8 last:border-0">
      <h3 className="mb-1 text-xs font-bold tracking-wide text-muted uppercase">{title}</h3>
      {hint && <p className="mb-3 text-sm text-faint">{hint}</p>}
      <div className={hint ? '' : 'mt-3'}>{children}</div>
    </section>
  );
}

/** Interruptor com rótulo e descrição, como os do Discord. */
export function Toggle({
  label,
  description,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={`flex items-start gap-4 py-2 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{label}</span>
        {description && <span className="block text-sm text-faint">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-6 w-10 shrink-0 rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-elevated'}`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left] ${checked ? 'left-[18px]' : 'left-0.5'}`}
        />
      </button>
    </label>
  );
}

import type { ReactNode } from 'react';
import { MESSAGE_FONT_SIZES } from '../../lib/settings';
import { useRealtime } from '../../state/realtime';
import { useSettings } from '../../state/settings';
import { Avatar } from '../Avatar';
import { SettingsGroup, Toggle } from './SettingsModal';

export function AppearanceSettings() {
  const { settings, update } = useSettings();
  const { state } = useRealtime();
  const { messageFontSize, compact, linkPreviews } = settings.appearance;
  const setAppearance = (patch: Partial<typeof settings.appearance>) =>
    update((s) => ({ ...s, appearance: { ...s.appearance, ...patch } }));
  const name = state.me?.displayName ?? 'Você';

  return (
    <>
      <SettingsGroup title="Prévia">
        <div className="rounded-lg border border-line bg-panel py-3">
          <PreviewMessage name={name} color={state.me?.avatarColor ?? '#2bb39a'} compact={compact} time="14:05">
            Olha que legal: dá para mudar o <strong>tamanho do texto</strong> e deixar as mensagens mais compactas.
          </PreviewMessage>
          <PreviewMessage name="Coreto" color="#2bb39a" compact={compact} time="14:06">
            As mudanças valem na hora e ficam guardadas neste aparelho.
          </PreviewMessage>
        </div>
      </SettingsGroup>

      <SettingsGroup title="Tamanho do texto das mensagens">
        <div className="flex items-center gap-4">
          <span className="text-xs text-faint">{MESSAGE_FONT_SIZES.min}px</span>
          <input
            type="range"
            min={MESSAGE_FONT_SIZES.min}
            max={MESSAGE_FONT_SIZES.max}
            step={1}
            value={messageFontSize}
            onChange={(e) => setAppearance({ messageFontSize: Number(e.target.value) })}
            aria-label="Tamanho do texto das mensagens"
            className="flex-1 accent-accent"
          />
          <span className="text-xs text-faint">{MESSAGE_FONT_SIZES.max}px</span>
          <span className="w-12 text-right text-sm font-semibold">{messageFontSize}px</span>
        </div>
      </SettingsGroup>

      <SettingsGroup title="Exibição das mensagens">
        <Toggle
          label="Modo compacto"
          description="Uma linha por mensagem, com hora e nome, sem avatares. Cabe mais conversa na tela."
          checked={compact}
          onChange={(v) => setAppearance({ compact: v })}
        />
        <div className="mt-3">
          <Toggle
            label="Pré-visualização de links"
            description="Mostra, embaixo da mensagem, o título, a descrição e a imagem do primeiro link, e links de imagens e GIFs aparecem como a própria imagem. As páginas são buscadas pelo servidor do Coreto, que não passa o seu endereço para os sites."
            checked={linkPreviews}
            onChange={(v) => setAppearance({ linkPreviews: v })}
          />
        </div>
      </SettingsGroup>
    </>
  );
}

function PreviewMessage({
  name,
  color,
  compact,
  time,
  children,
}: {
  name: string;
  color: string;
  compact: boolean;
  time: string;
  children: ReactNode;
}) {
  const text = <span className="text-[length:var(--message-font-size)] leading-relaxed text-fg/95">{children}</span>;
  if (compact) {
    return (
      <div className="flex gap-2 px-4 py-0.5">
        <time className="w-11 shrink-0 pt-[0.3em] text-right text-[11px] text-faint">{time}</time>
        <p className="min-w-0">
          <span className="mr-1.5 font-medium">{name}</span>
          {text}
        </p>
      </div>
    );
  }
  return (
    <div className="mt-2 flex gap-4 px-4 py-0.5 first:mt-0">
      <Avatar name={name} color={color} />
      <div className="min-w-0">
        <p className="flex items-baseline gap-2">
          <span className="font-medium">{name}</span>
          <span className="text-xs text-faint">Hoje às {time}</span>
        </p>
        <p>{text}</p>
      </div>
    </div>
  );
}

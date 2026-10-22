import { useState } from 'react';
import { askNotificationAccess, notificationAccess, showToast, type NotificationAccess } from '../../lib/notifications';
import { useSettings } from '../../state/settings';
import { SettingsGroup, Toggle } from './SettingsModal';

const ACCESS_HINT: Record<NotificationAccess, string> = {
  granted: 'O sistema deixa o Coreto mostrar notificações.',
  default: 'O navegador ainda não deixou o Coreto mostrar notificações. Clique em "Permitir" para ativar.',
  denied: 'O navegador bloqueou as notificações do Coreto. Libere nas configurações do site (o cadeado ao lado do endereço).',
  unsupported: 'Este navegador não mostra notificações.',
};

export function NotificationSettings() {
  const { settings, update } = useSettings();
  const { enabled, preview } = settings.notifications;
  const [access, setAccess] = useState<NotificationAccess>(notificationAccess);
  const set = (patch: Partial<typeof settings.notifications>) =>
    update((s) => ({ ...s, notifications: { ...s.notifications, ...patch } }));

  return (
    <SettingsGroup
      title="Notificações"
      hint="Um aviso do sistema (no Windows, no canto da tela) quando chega uma mensagem direta, alguém menciona ou responde a você num canal, e o Coreto não está à vista. Com o Coreto aberto na sua frente, vale o contador de mensagens não lidas. Não avisa com o seu status em Não perturbe."
    >
      <Toggle label="Mostrar notificações" checked={enabled} onChange={(v) => set({ enabled: v })} />
      <div className={`mt-3 ${enabled ? '' : 'pointer-events-none opacity-50'}`}>
        <Toggle label="Mostrar o texto da mensagem" checked={preview} onChange={(v) => set({ preview: v })} />
        <p className="mt-1 text-xs text-faint">Desligado, a notificação só diz quem escreveu, sem o que foi escrito.</p>
      </div>

      <p className="mt-5 text-sm text-muted">{ACCESS_HINT[access]}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {access === 'default' && (
          <button
            type="button"
            onClick={() => void askNotificationAccess().then(setAccess)}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-strong"
          >
            Permitir
          </button>
        )}
        <button
          type="button"
          disabled={access !== 'granted'}
          onClick={() => showToast({ title: 'Coreto', body: 'Assim aparecem as notificações.', tag: 'teste' }, () => {})}
          className="rounded-md bg-elevated px-3 py-1.5 text-sm hover:bg-hover disabled:opacity-50"
        >
          Enviar uma notificação de teste
        </button>
      </div>
    </SettingsGroup>
  );
}

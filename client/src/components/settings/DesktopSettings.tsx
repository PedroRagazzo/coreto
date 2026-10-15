import { CheckCircle2, Download, LoaderCircle, RefreshCw, TriangleAlert } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { desktop, type UpdateState } from '../../lib/desktop';
import { DownloadApp } from '../DownloadApp';
import { SettingsGroup, Toggle } from './SettingsModal';

/** Estado da atualização do app de desktop, ao vivo. `null` no navegador. */
export function useDesktopUpdate(): UpdateState | null {
  const [state, setState] = useState<UpdateState | null>(null);
  useEffect(() => {
    if (!desktop) return;
    void desktop.getUpdateState().then(setState);
    return desktop.onUpdateState(setState);
  }, []);
  return state;
}

function describe(state: UpdateState | null): { icon: ReactNode; text: string } {
  switch (state?.status) {
    case 'checking':
      return { icon: <LoaderCircle size={18} className="animate-spin" />, text: 'Procurando atualizações…' };
    case 'available':
    case 'downloading':
      return {
        icon: <Download size={18} className="text-accent" />,
        text: `Baixando a versão ${state.version ?? 'nova'}… ${Math.round(state.percent ?? 0)}%`,
      };
    case 'ready':
      return {
        icon: <CheckCircle2 size={18} className="text-online" />,
        text: `A versão ${state.version} está pronta. Reinicie o app para usar.`,
      };
    case 'latest':
      return { icon: <CheckCircle2 size={18} className="text-online" />, text: 'Você está na versão mais recente.' };
    case 'error':
      return { icon: <TriangleAlert size={18} className="text-dnd" />, text: `Não deu para verificar: ${state.error ?? 'erro desconhecido'}` };
    case 'unsupported':
      return { icon: <TriangleAlert size={18} className="text-idle" />, text: 'Atualização automática só no app instalado.' };
    default:
      return { icon: <RefreshCw size={18} />, text: 'O app procura atualizações ao abrir e a cada 4 horas.' };
  }
}

export function DesktopSettings() {
  const update = useDesktopUpdate();
  const [openAtLogin, setOpenAtLogin] = useState<boolean | null>(null);
  const [closeToTray, setCloseToTray] = useState<boolean | null>(null);

  useEffect(() => {
    void desktop?.getOpenAtLogin().then(setOpenAtLogin);
    void desktop?.getCloseToTray?.().then(setCloseToTray);
  }, []);

  // No navegador esta aba só oferece o instalador.
  if (!desktop) {
    return (
      <SettingsGroup
        title="Baixar o app"
        hint="O app de desktop fica na bandeja do Windows, abre junto com o computador e se atualiza sozinho."
      >
        <DownloadApp />
        <p className="mt-2 text-xs text-faint">
          Se o Windows avisar que o programa pode ser perigoso, clique em “Mais informações” e depois em “Executar assim mesmo”.
        </p>
      </SettingsGroup>
    );
  }
  const { icon, text } = describe(update);
  const busy = update?.status === 'checking' || update?.status === 'downloading' || update?.status === 'available';

  return (
    <>
      <SettingsGroup title="Atualizações" hint={`Coreto para ${desktop.platform === 'win32' ? 'Windows' : desktop.platform}, versão ${desktop.version}.`}>
        <div className="flex items-center gap-3 rounded-md bg-rail p-3" role="status">
          {icon}
          <p className="flex-1 text-sm">{text}</p>
          {update?.status === 'ready' ? (
            <button
              type="button"
              onClick={() => desktop?.installUpdate()}
              className="rounded-md bg-online px-4 py-1.5 text-sm font-semibold text-rail hover:bg-online/85"
            >
              Reiniciar e atualizar
            </button>
          ) : (
            <button
              type="button"
              disabled={busy || update?.status === 'unsupported'}
              onClick={() => void desktop?.checkForUpdates()}
              className="rounded-md bg-elevated px-4 py-1.5 text-sm font-semibold hover:bg-hover disabled:opacity-50"
            >
              Verificar agora
            </button>
          )}
        </div>
        {update?.status === 'downloading' && (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-rail" aria-hidden>
            <div className="h-full bg-accent transition-[width]" style={{ width: `${update.percent ?? 0}%` }} />
          </div>
        )}
        {update?.checkedAt && (
          <p className="mt-2 text-xs text-faint">Última verificação: {new Date(update.checkedAt).toLocaleString('pt-BR')}</p>
        )}
      </SettingsGroup>

      {/* O app 0.2.0 ainda não tinha bandeja; o interruptor aparece a partir da versão seguinte. */}
      {desktop.getCloseToTray && (
        <SettingsGroup title="Janela">
          <Toggle
            label="Minimizar para a bandeja ao fechar"
            description="Fechar a janela deixa o Coreto rodando na bandeja do Windows, inclusive numa chamada. Para sair de vez, clique com o botão direito no ícone da bandeja."
            checked={closeToTray ?? true}
            disabled={closeToTray === null}
            onChange={(v) => void desktop?.setCloseToTray?.(v).then(setCloseToTray)}
          />
        </SettingsGroup>
      )}

      <SettingsGroup title="Inicialização">
        <Toggle
          label="Abrir o Coreto ao ligar o computador"
          description={
            openAtLogin === null
              ? 'Disponível só no app instalado.'
              : 'O app abre sozinho, direto na bandeja, quando você entra no Windows.'
          }
          checked={openAtLogin ?? false}
          disabled={openAtLogin === null}
          onChange={(v) => void desktop?.setOpenAtLogin(v).then(setOpenAtLogin)}
        />
      </SettingsGroup>
    </>
  );
}

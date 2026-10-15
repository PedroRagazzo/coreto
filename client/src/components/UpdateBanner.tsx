import { Download, X } from 'lucide-react';
import { useState } from 'react';
import { desktop } from '../lib/desktop';
import { useDesktopUpdate } from './settings/DesktopSettings';

/** Faixa no topo quando o app de desktop baixou uma versão nova, como o ícone verde do Discord. */
export function UpdateBanner() {
  const update = useDesktopUpdate();
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (!desktop || update?.status !== 'ready' || dismissed === update.version) return null;

  return (
    <div role="status" className="flex items-center gap-3 bg-accent-strong px-4 py-1.5 text-sm text-white">
      <Download size={16} className="shrink-0" />
      <p className="flex-1">A versão {update.version} do Coreto está pronta.</p>
      <button type="button" onClick={() => desktop?.installUpdate()} className="rounded bg-white/20 px-3 py-0.5 font-semibold hover:bg-white/30">
        Reiniciar agora
      </button>
      <button
        type="button"
        onClick={() => setDismissed(update.version ?? '')}
        aria-label="Depois (instala ao fechar o app)"
        title="Depois: a atualização é instalada quando você fechar o app"
        className="rounded p-0.5 hover:bg-white/20"
      >
        <X size={16} />
      </button>
    </div>
  );
}

import { useState } from 'react';
import { useRealtime } from '../state/realtime';
import { Modal } from './Modal';
import { loadScreenOptions, saveScreenOptions, ScreenQualityFields, type ScreenQuality } from './ScreenQualityFields';

/**
 * Qualidade da transmissão que já está no ar: cada escolha vale na hora, sem parar nem escolher
 * a tela de novo. A última escolha também fica guardada para a próxima transmissão.
 */
export function StreamSettingsDialog({ onClose }: { onClose: () => void }) {
  const { actions } = useRealtime();
  const [quality, setQuality] = useState<ScreenQuality>(() => actions.screenOptions() ?? loadScreenOptions());
  const [error, setError] = useState<string | null>(null);

  async function change(patch: Partial<ScreenQuality>) {
    setQuality((q) => ({ ...q, ...patch }));
    setError(null);
    const applied = await actions.updateScreenOptions(patch);
    if (!applied) return setError('A transmissão terminou. Comece de novo para mudar a qualidade.');
    saveScreenOptions({ ...loadScreenOptions(), ...applied });
  }

  return (
    <Modal
      title="Configurações da transmissão"
      description="As mudanças valem na hora para quem está assistindo."
      onClose={onClose}
    >
      <ScreenQualityFields value={quality} onChange={(patch) => void change(patch)} />
      {error && (
        <p role="alert" className="mt-3 text-sm text-dnd">
          {error}
        </p>
      )}
      <div className="mt-6 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          data-autofocus
          className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-strong"
        >
          Pronto
        </button>
      </div>
    </Modal>
  );
}

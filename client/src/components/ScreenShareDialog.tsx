import { useState, type FormEvent } from 'react';
import { desktop } from '../lib/desktop';
import { useRealtime } from '../state/realtime';
import { DialogActions, Modal } from './Modal';
import { bestScreenQuality, loadScreenOptions, saveScreenOptions } from './ScreenQualityFields';

/** Só o som: a qualidade é sempre a melhor (ajusta-se com a transmissão no ar); depois, o próprio navegador pergunta qual tela, janela ou aba. */
export function ScreenShareDialog({ onClose }: { onClose: () => void }) {
  const { state, actions } = useRealtime();
  const [audio, setAudio] = useState(() => loadScreenOptions().audio);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const options = { ...bestScreenQuality(), audio };
    saveScreenOptions(options);
    setBusy(true);
    // Chamado direto do clique: o navegador só abre o seletor de tela a partir de um gesto.
    const err = await actions.startScreenShare(options);
    setBusy(false);
    if (err) setError(err);
    else onClose();
  }

  return (
    <Modal
      title="Compartilhar tela"
      description={`Transmitir em ${state.myVoice.channelName ?? 'canal de voz'}. Só recebe o vídeo quem escolher assistir.`}
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={audio}
            onChange={(e) => setAudio(e.target.checked)}
            className="h-4 w-4 accent-accent"
          />
          {desktop?.appAudio
            ? 'Incluir o som do programa compartilhado (a chamada do Coreto não vai junto)'
            : 'Incluir o som (o navegador oferece para abas e, no Windows, para a tela inteira)'}
        </label>

        {error && (
          <p role="alert" className="mt-3 text-sm text-dnd">
            {error}
          </p>
        )}
        <DialogActions onCancel={onClose} submitLabel={busy ? 'Escolhendo…' : 'Escolher tela'} disabled={busy} />
      </form>
    </Modal>
  );
}

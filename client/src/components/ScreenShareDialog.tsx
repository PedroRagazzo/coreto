import { useEffect, useState, type FormEvent } from 'react';
import { desktop } from '../lib/desktop';
import { type HardwareSupport, launchFrameRate } from '@shared/h264';
import { probeHardwareH264, widthFor } from '../lib/encoder';
import { supportsH264, type ScreenShareOptions } from '../lib/voice';
import { useRealtime } from '../state/realtime';
import { DialogActions, Modal } from './Modal';
import {
  bestScreenQuality,
  ENCODERS,
  LAUNCH_RESOLUTIONS,
  loadLaunchEncoder,
  loadLaunchResolution,
  loadScreenOptions,
  saveScreenOptions,
  Segmented,
  type LaunchResolution,
} from './ScreenQualityFields';
import { labelClass } from './Modal';

/** O que dizer sobre a escolha de quem codifica, conforme o que o navegador respondeu sobre a placa de vídeo. */
function encoderHint(encoder: ScreenShareOptions['codec'], support: HardwareSupport | undefined, resolutionLabel: string): string {
  if (encoder === 'vp8') return 'O processador codifica: funciona em qualquer computador, mas pesa no jogo. Use se a placa de vídeo der problema.';
  if (!supportsH264()) return 'Este navegador não codifica H.264, então vai usar o processador.';
  if (support === undefined) return 'Conferindo a placa de vídeo…';
  if (support.fps60) return 'A placa de vídeo codifica nesta resolução a 60 quadros por segundo: o processador fica livre para o jogo.';
  if (support.fps30) {
    return `A placa de vídeo só codifica o ${resolutionLabel} a 30 quadros por segundo no navegador (a 60, ele usaria o processador). A transmissão sai a 30 fps pela placa. Para 60 fps pela placa, escolha 1080p ou menos.`;
  }
  if (support.fps60 === false && support.fps30 === false) {
    return 'Este computador não oferece a placa de vídeo para codificar nesta resolução, e a transmissão vai usar o processador. Atualize o driver da placa de vídeo ou escolha uma resolução menor.';
  }
  return 'Não deu para conferir antes. Com a transmissão no ar, o painel de estatísticas mostra quem está codificando.';
}

/**
 * Três escolhas: a resolução (720p, 1080p ou 2K), quem codifica (placa de vídeo ou processador) e o som; o resto da qualidade
 * sai no melhor (e se ajusta com a transmissão no ar). Depois, o próprio navegador pergunta qual tela, janela ou aba.
 */
export function ScreenShareDialog({ onClose }: { onClose: () => void }) {
  const { state, actions } = useRealtime();
  const [audio, setAudio] = useState(() => loadScreenOptions().audio);
  const [resolution, setResolution] = useState<LaunchResolution>(loadLaunchResolution);
  const [encoder, setEncoder] = useState<ScreenShareOptions['codec']>(loadLaunchEncoder);
  // O que o navegador diz da placa de vídeo nessa resolução (`undefined` = ainda conferindo).
  const [support, setSupport] = useState<HardwareSupport | undefined>(undefined);
  useEffect(() => {
    if (encoder !== 'h264' || !supportsH264()) return;
    let current = true;
    setSupport(undefined);
    void (async () => {
      const fps60 = await probeHardwareH264(widthFor(resolution), resolution, 60);
      const fps30 = fps60 ? true : await probeHardwareH264(widthFor(resolution), resolution, 30);
      if (current) setSupport({ fps60, fps30 });
    })();
    return () => {
      current = false;
    };
  }, [encoder, resolution]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const options = { ...bestScreenQuality(resolution, encoder), frameRate: launchFrameRate(encoder, support), audio };
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
        <fieldset>
          <legend className={labelClass}>Qualidade da transmissão</legend>
          <Segmented
            name="resolucao"
            options={LAUNCH_RESOLUTIONS.map((r) => ({ key: String(r.value), label: r.label, selected: resolution === r.value }))}
            onSelect={(key) => setResolution(Number(key) as LaunchResolution)}
          />
          <p className="mt-1.5 text-xs text-faint">{LAUNCH_RESOLUTIONS.find((r) => r.value === resolution)?.hint}</p>
        </fieldset>

        <fieldset className="mt-4">
          <legend className={labelClass}>Quem codifica o vídeo</legend>
          <Segmented
            name="codificador"
            options={ENCODERS.map((e) => ({ key: e.value, label: e.label, selected: encoder === e.value }))}
            onSelect={(key) => setEncoder(key as ScreenShareOptions['codec'])}
          />
          <p className="mt-1.5 text-xs text-faint" data-testid="encoder-hint">
            {encoderHint(encoder, support, LAUNCH_RESOLUTIONS.find((r) => r.value === resolution)?.label ?? `${resolution}p`)}
          </p>
        </fieldset>

        <label className="mt-4 flex items-center gap-2 text-sm">
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

import { useEffect, useState, type FormEvent } from 'react';
import { type HardwareSupport, launchFrameRate } from '@shared/h264';
import { desktop } from '../lib/desktop';
import { nativeScreenSize, probeHardwareH264, widthFor } from '../lib/encoder';
import { supportsH264, type ScreenShareOptions } from '../lib/voice';
import { useRealtime } from '../state/realtime';
import { DialogActions, Modal } from './Modal';
import {
  bestScreenQuality,
  ENCODERS,
  LAUNCH_FRAME_RATES,
  LAUNCH_RESOLUTIONS,
  loadLaunchEncoder,
  loadLaunchFrameRate,
  loadLaunchResolution,
  loadScreenOptions,
  saveLaunchFrameRate,
  saveScreenOptions,
  Segmented,
  type LaunchFrameRate,
  type LaunchResolution,
} from './ScreenQualityFields';
import { labelClass } from './Modal';

/** O que dizer sobre a escolha de quem codifica, conforme o que o navegador respondeu sobre a placa de vídeo. */
function encoderHint(
  encoder: ScreenShareOptions['codec'],
  support: HardwareSupport | undefined,
  size: string,
  frameRate: LaunchFrameRate,
  pickedFrameRate: boolean,
): string {
  if (encoder === 'vp8') return 'O processador codifica: funciona em qualquer computador, mas pesa no jogo. Use se a placa de vídeo der problema.';
  if (!supportsH264()) return 'Este navegador não codifica H.264, então vai usar o processador.';
  if (support === undefined) return 'Conferindo a placa de vídeo…';
  // A placa codifica esse tamanho a 30 quadros mas não a 60 (o 2K no Chromium): explica, em vez da mensagem de sempre.
  if (support.fps60 === false && support.fps30 && (frameRate >= 60 || !pickedFrameRate)) {
    return `A placa de vídeo só codifica ${size} a 30 quadros por segundo no navegador (a 60, ele usaria o processador). ${
      pickedFrameRate ? 'Escolha 30 fps para usar a placa.' : 'A transmissão sai a 30 fps pela placa.'
    } Para 60 fps pela placa, escolha 1080p ou menos.`;
  }
  const hardware = frameRate >= 60 ? support.fps60 : support.fps30;
  if (hardware) {
    return frameRate >= 60
      ? 'A placa de vídeo codifica nesta resolução a 60 quadros por segundo: o processador fica livre para o jogo.'
      : 'A placa de vídeo codifica nesta resolução: o processador fica livre para o jogo.';
  }
  if (hardware === false) {
    return 'Este computador não oferece a placa de vídeo para codificar nesta resolução, e a transmissão vai usar o processador. Atualize o driver da placa de vídeo ou escolha uma resolução menor.';
  }
  return 'Não deu para conferir antes. Com a transmissão no ar, o painel de estatísticas mostra quem está codificando.';
}

/**
 * As escolhas antes de transmitir: resolução (720p, 1080p, 2K ou Original, a recomendada), quadros por segundo, quem
 * codifica (placa de vídeo ou processador) e o som; o resto da qualidade sai no melhor. Depois, o próprio navegador pergunta
 * qual tela, janela ou aba. Com a transmissão no ar só se troca a tela: para mudar a qualidade, comece de novo.
 */
export function ScreenShareDialog({ onClose }: { onClose: () => void }) {
  const { state, actions } = useRealtime();
  const [audio, setAudio] = useState(() => loadScreenOptions().audio);
  const [resolution, setResolution] = useState<LaunchResolution>(loadLaunchResolution);
  const [encoder, setEncoder] = useState<ScreenShareOptions['codec']>(loadLaunchEncoder);
  // Os quadros que a pessoa escolheu; `null` enquanto ela não mexeu: aí o Coreto decide (30 quando a placa só codifica a 30).
  const [pickedFrameRate, setPickedFrameRate] = useState<LaunchFrameRate | null>(loadLaunchFrameRate);
  // O que o navegador diz da placa de vídeo nessa resolução (`undefined` = ainda conferindo).
  const [support, setSupport] = useState<HardwareSupport | undefined>(undefined);
  useEffect(() => {
    if (encoder !== 'h264' || !supportsH264()) return;
    let current = true;
    setSupport(undefined);
    // A "Original" sai do tamanho da tela: é esse tamanho que a placa de vídeo precisa aguentar.
    const { width, height } = resolution ? { width: widthFor(resolution), height: resolution } : nativeScreenSize();
    void (async () => {
      const fps60 = await probeHardwareH264(width, height, 60);
      const fps30 = fps60 ? true : await probeHardwareH264(width, height, 30);
      if (current) setSupport({ fps60, fps30 });
    })();
    return () => {
      current = false;
    };
  }, [encoder, resolution]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const frameRate: LaunchFrameRate = pickedFrameRate ?? launchFrameRate(encoder, support);
  const resolutionInfo = LAUNCH_RESOLUTIONS.find((r) => r.value === resolution);
  const sizeLabel = resolution === null ? 'o tamanho da sua tela' : `o ${resolutionInfo?.label ?? `${resolution}p`}`;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const options = { ...bestScreenQuality(resolution, encoder), frameRate, audio };
    saveScreenOptions(options);
    saveLaunchFrameRate(pickedFrameRate);
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
          <legend className={labelClass}>Resolução</legend>
          <Segmented
            name="resolucao"
            options={LAUNCH_RESOLUTIONS.map((r) => ({ key: String(r.value), label: r.label, badge: r.badge, selected: resolution === r.value }))}
            onSelect={(key) => setResolution(LAUNCH_RESOLUTIONS.find((r) => String(r.value) === key)!.value)}
          />
          <p className="mt-1.5 text-xs text-faint">{resolutionInfo?.hint}</p>
        </fieldset>

        <fieldset className="mt-4">
          <legend className={labelClass}>Quadros por segundo</legend>
          <Segmented
            name="quadros"
            options={LAUNCH_FRAME_RATES.map((fps) => ({ key: String(fps), label: `${fps} fps`, selected: frameRate === fps }))}
            onSelect={(key) => setPickedFrameRate(Number(key) as LaunchFrameRate)}
          />
          <p className="mt-1.5 text-xs text-faint">60 fps para jogos e vídeos; 15 fps deixa texto e código mais nítidos com menos internet.</p>
        </fieldset>

        <fieldset className="mt-4">
          <legend className={labelClass}>Quem codifica o vídeo</legend>
          <Segmented
            name="codificador"
            options={ENCODERS.map((e) => ({ key: e.value, label: e.label, selected: encoder === e.value }))}
            onSelect={(key) => setEncoder(key as ScreenShareOptions['codec'])}
          />
          <p className="mt-1.5 text-xs text-faint" data-testid="encoder-hint">
            {encoderHint(encoder, support, sizeLabel, frameRate, pickedFrameRate !== null)}
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

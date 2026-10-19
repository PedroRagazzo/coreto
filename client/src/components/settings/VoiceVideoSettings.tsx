import { Mic, Video } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { SENSITIVITY_RANGE, type VoicePrefs } from '../../lib/settings';
import { applyOutput, MicPipeline, openMicrophone, type MicLevel } from '../../lib/voice';
import { useSettings } from '../../state/settings';
import { SettingsGroup, Toggle } from './SettingsModal';

/** Pseudo-dispositivos do Chrome que repetem o "padrão do sistema", já oferecido à parte. */
const PSEUDO_DEVICES = new Set(['default', 'communications']);
const canChooseOutput = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
const selectClass =
  'w-full rounded-md bg-rail px-3 py-2 text-sm text-fg outline-none focus:ring-2 focus:ring-accent disabled:opacity-50';

function useDevices() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const refresh = useCallback(async () => {
    setDevices(await navigator.mediaDevices.enumerateDevices());
  }, []);
  useEffect(() => {
    void refresh();
    navigator.mediaDevices.addEventListener('devicechange', refresh);
    return () => navigator.mediaDevices.removeEventListener('devicechange', refresh);
  }, [refresh]);
  return { devices, refresh };
}

export function VoiceVideoSettings() {
  const { settings, update } = useSettings();
  const prefs = settings.voice;
  const { devices, refresh } = useDevices();
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const setVoice = (patch: Partial<VoicePrefs>) => update((s) => ({ ...s, voice: { ...s.voice, ...patch } }));

  const of = (kind: MediaDeviceKind) => devices.filter((d) => d.kind === kind && !PSEUDO_DEVICES.has(d.deviceId));
  // Sem permissão, o navegador esconde os nomes dos dispositivos.
  const namesHidden = devices.length > 0 && devices.every((d) => !d.label);

  const askPermission = async () => {
    setPermissionError(null);
    try {
      const stream = await navigator.mediaDevices
        .getUserMedia({ audio: true, video: true })
        .catch(() => navigator.mediaDevices.getUserMedia({ audio: true }));
      stream.getTracks().forEach((t) => t.stop());
      await refresh();
    } catch {
      setPermissionError('O navegador não liberou o microfone. Libere nas permissões do site e tente de novo.');
    }
  };

  return (
    <>
      {namesHidden && (
        <div className="mb-6 flex items-center gap-3 rounded-md border border-line bg-rail p-3 text-sm">
          <p className="flex-1 text-muted">Para ver os nomes dos seus microfones e câmeras, o navegador precisa de permissão.</p>
          <button type="button" onClick={askPermission} className="rounded-md bg-accent px-3 py-1.5 font-semibold text-white hover:bg-accent-strong">
            Permitir acesso
          </button>
        </div>
      )}
      {permissionError && <p className="mb-4 text-sm text-dnd">{permissionError}</p>}

      <SettingsGroup title="Dispositivos">
        <div className="grid gap-4 sm:grid-cols-2">
          <DeviceSelect
            label="Microfone"
            devices={of('audioinput')}
            value={prefs.inputDeviceId}
            onChange={(id) => setVoice({ inputDeviceId: id })}
          />
          <DeviceSelect
            label="Saída de áudio"
            devices={of('audiooutput')}
            value={prefs.outputDeviceId}
            onChange={(id) => setVoice({ outputDeviceId: id })}
            disabled={!canChooseOutput}
            hint={canChooseOutput ? undefined : 'Este navegador não deixa escolher a saída; use o padrão do sistema.'}
          />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Slider
            label="Volume do microfone"
            value={prefs.inputVolume}
            max={2}
            onChange={(v) => setVoice({ inputVolume: v })}
          />
          <Slider label="Volume das chamadas" value={prefs.outputVolume} max={1} onChange={(v) => setVoice({ outputVolume: v })} />
        </div>
      </SettingsGroup>

      <SettingsGroup
        title="Sensibilidade de entrada"
        hint="Clique em Testar e fale: a barra mostra o que o microfone capta. Com a detecção automática desligada, só passa o que ultrapassa a marca."
      >
        <MicTest prefs={prefs} onChange={setVoice} />
      </SettingsGroup>

      <SettingsGroup title="Processamento de voz" hint="Valem na hora, inclusive no meio de uma chamada.">
        <Toggle
          label="Cancelamento de eco"
          description="Evita que o som das caixas de som volte pelo microfone."
          checked={prefs.echoCancellation}
          onChange={(v) => setVoice({ echoCancellation: v })}
        />
        <Toggle
          label="Supressão de ruído"
          description="Reduz ventilador, teclado e barulho de fundo."
          checked={prefs.noiseSuppression}
          onChange={(v) => setVoice({ noiseSuppression: v })}
        />
        <Toggle
          label="Controle automático de ganho"
          description="Ajusta o volume da sua voz sozinho. Desligue para controlar só pelo volume do microfone."
          checked={prefs.autoGainControl}
          onChange={(v) => setVoice({ autoGainControl: v })}
        />
      </SettingsGroup>

      <SettingsGroup title="Vídeo">
        <DeviceSelect
          label="Câmera"
          devices={of('videoinput')}
          value={prefs.cameraDeviceId}
          onChange={(id) => setVoice({ cameraDeviceId: id })}
        />
        <CameraPreview deviceId={prefs.cameraDeviceId} />
      </SettingsGroup>
    </>
  );
}

function DeviceSelect({
  label,
  devices,
  value,
  onChange,
  disabled = false,
  hint,
}: {
  label: string;
  devices: MediaDeviceInfo[];
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
  hint?: string;
}) {
  // O escolhido pode ter sido desconectado: continua na lista para não sumir sem aviso.
  const missing = value !== null && !devices.some((d) => d.deviceId === value);
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-bold tracking-wide text-muted uppercase">{label}</span>
      <select
        value={value ?? ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value || null)}
        className={selectClass}
      >
        <option value="">Padrão do sistema</option>
        {devices.map((d, i) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || `${label} ${i + 1}`}
          </option>
        ))}
        {missing && <option value={value}>Desconectado (usa o padrão)</option>}
      </select>
      {hint && <span className="mt-1 block text-xs text-faint">{hint}</span>}
    </label>
  );
}

export function Slider({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex justify-between text-xs font-bold tracking-wide text-muted uppercase">
        {label}
        <span className="font-normal normal-case">{Math.round(value * 100)}%</span>
      </span>
      <input
        type="range"
        min={0}
        max={max}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-accent"
      />
    </label>
  );
}

/** Posição de um nível em dB na barra, de 0 a 1. */
const dbPosition = (db: number) =>
  Math.min(1, Math.max(0, (db - SENSITIVITY_RANGE.min) / (SENSITIVITY_RANGE.max - SENSITIVITY_RANGE.min)));

/**
 * Abre o microfone com as configurações atuais (volume e sensibilidade incluídos) e mostra o
 * nível em dB, com a marca da sensibilidade. Opcionalmente toca de volta o que passou pela porta.
 */
function MicTest({ prefs, onChange }: { prefs: VoicePrefs; onChange: (patch: Partial<VoicePrefs>) => void }) {
  const [running, setRunning] = useState(false);
  const [listen, setListen] = useState(false);
  const [level, setLevel] = useState<MicLevel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const pipelineRef = useRef<MicPipeline | null>(null);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  useEffect(() => {
    if (!running) return;
    let stopped = false;
    let pipeline: MicPipeline | null = null;
    (async () => {
      let raw: MediaStream | null = null;
      try {
        raw = await openMicrophone(prefsRef.current);
        pipeline = await MicPipeline.create(prefsRef.current, setLevel);
        if (stopped) {
          raw.getTracks().forEach((t) => t.stop());
          return pipeline.close();
        }
        pipeline.use(raw);
        pipelineRef.current = pipeline;
        if (audioRef.current) {
          audioRef.current.srcObject = pipeline.stream;
          applyOutput(audioRef.current, prefsRef.current, 1);
        }
      } catch {
        raw?.getTracks().forEach((t) => t.stop());
        pipeline?.close();
        setError('Não deu para abrir o microfone. Confira a permissão e o dispositivo escolhido.');
        setRunning(false);
      }
    })();
    return () => {
      stopped = true;
      pipeline?.close();
      pipelineRef.current = null;
      setLevel(null);
    };
    // Reabre ao trocar o microfone ou o processamento; volume e sensibilidade mudam sem reabrir (abaixo).
  }, [running, prefs.inputDeviceId, prefs.echoCancellation, prefs.noiseSuppression, prefs.autoGainControl, prefs.outputDeviceId]);

  useEffect(() => pipelineRef.current?.setVolume(prefs.inputVolume), [prefs.inputVolume]);
  useEffect(() => pipelineRef.current?.setSensitivity(prefs), [prefs.autoSensitivity, prefs.inputSensitivity]);

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.muted = !listen;
    if (listen && running) void audioRef.current.play().catch(() => {});
  }, [listen, running]);

  const db = level?.db ?? -Infinity;
  const gated = !prefs.autoSensitivity && level !== null && !level.open;

  return (
    <div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => {
            setError(null);
            setRunning((r) => !r);
          }}
          className={`flex shrink-0 items-center gap-1.5 rounded-md px-4 py-2 text-sm font-semibold text-white ${
            running ? 'bg-dnd hover:bg-dnd/85' : 'bg-accent hover:bg-accent-strong'
          }`}
        >
          <Mic size={16} />
          {running ? 'Parar teste' : 'Testar'}
        </button>
        <div
          role="meter"
          aria-label="Nível do microfone"
          aria-valuemin={SENSITIVITY_RANGE.min}
          aria-valuemax={SENSITIVITY_RANGE.max}
          aria-valuenow={Number.isFinite(db) ? Math.round(db) : SENSITIVITY_RANGE.min}
          className="relative h-3 flex-1 overflow-hidden rounded-full bg-rail"
        >
          <div
            className={`h-full rounded-full transition-[width] duration-75 ${gated ? 'bg-faint' : 'bg-online'}`}
            style={{ width: `${dbPosition(db) * 100}%` }}
          />
          {!prefs.autoSensitivity && (
            <div
              aria-hidden
              className="absolute top-0 h-full w-0.5 bg-fg"
              style={{ left: `${dbPosition(prefs.inputSensitivity) * 100}%` }}
            />
          )}
        </div>
      </div>

      <div className="mt-4">
        <Toggle
          label="Detectar a sensibilidade automaticamente"
          description="O microfone fica sempre aberto. Desligue para escolher o nível mínimo, como no Discord."
          checked={prefs.autoSensitivity}
          onChange={(v) => onChange({ autoSensitivity: v })}
        />
        <label className={`mt-2 block ${prefs.autoSensitivity ? 'opacity-50' : ''}`}>
          <span className="mb-1.5 flex justify-between text-xs font-bold tracking-wide text-muted uppercase">
            Sensibilidade
            <span className="font-normal normal-case">{prefs.inputSensitivity} dB</span>
          </span>
          <input
            type="range"
            min={SENSITIVITY_RANGE.min}
            max={SENSITIVITY_RANGE.max}
            step={1}
            value={prefs.inputSensitivity}
            disabled={prefs.autoSensitivity}
            onChange={(e) => onChange({ inputSensitivity: Number(e.target.value) })}
            className="w-full accent-accent"
          />
          <span className="mt-1 block text-xs text-faint">
            Mais à direita, só voz alta abre o microfone. A voz costuma ficar entre −40 e −20 dB.
          </span>
        </label>
      </div>

      <label className="mt-3 flex items-center gap-2 text-sm text-muted">
        <input type="checkbox" checked={listen} onChange={(e) => setListen(e.target.checked)} className="h-4 w-4 accent-accent" />
        Ouvir meu microfone (use fone para não dar microfonia)
      </label>
      <audio ref={audioRef} autoPlay muted hidden />
      {error && <p className="mt-2 text-sm text-dnd">{error}</p>}
    </div>
  );
}

function CameraPreview({ deviceId }: { deviceId: string | null }) {
  const [on, setOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!on) return;
    let stream: MediaStream | null = null;
    let stopped = false;
    navigator.mediaDevices
      .getUserMedia({ video: deviceId ? { deviceId: { exact: deviceId } } : true, audio: false })
      .then((s) => {
        if (stopped) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        if (videoRef.current) videoRef.current.srcObject = s;
      })
      .catch(() => {
        setError('Não deu para abrir a câmera. Confira a permissão e se outro programa está usando.');
        setOn(false);
      });
    return () => {
      stopped = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [on, deviceId]);

  return (
    <div className="mt-4">
      <div className="flex aspect-video w-full max-w-md items-center justify-center overflow-hidden rounded-lg bg-rail">
        {on ? (
          <video ref={videoRef} autoPlay playsInline muted className="h-full w-full -scale-x-100 object-cover" />
        ) : (
          <Video size={40} className="text-faint" />
        )}
      </div>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOn((v) => !v);
        }}
        className="mt-3 rounded-md bg-elevated px-4 py-2 text-sm font-semibold hover:bg-hover"
      >
        {on ? 'Desligar prévia' : 'Testar câmera'}
      </button>
      {error && <p className="mt-2 text-sm text-dnd">{error}</p>}
    </div>
  );
}

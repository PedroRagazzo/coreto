import { playSound, type SoundKind } from '../../lib/sounds';
import { useSettings } from '../../state/settings';
import { SettingsGroup, Toggle } from './SettingsModal';
import { Slider } from './VoiceVideoSettings';

const SAMPLES: { kind: SoundKind; label: string }[] = [
  { kind: 'join', label: 'Alguém entrou na chamada' },
  { kind: 'leave', label: 'Alguém saiu da chamada' },
  { kind: 'streamJoin', label: 'Alguém entrou na transmissão' },
  { kind: 'streamLeave', label: 'Alguém saiu da transmissão' },
  { kind: 'mute', label: 'Microfone desativado' },
  { kind: 'unmute', label: 'Microfone ativado' },
  { kind: 'deafen', label: 'Som desativado' },
  { kind: 'undeafen', label: 'Som ativado' },
];

export function SoundSettings() {
  const { settings, update } = useSettings();
  const { enabled, volume } = settings.sounds;
  const setSounds = (patch: Partial<typeof settings.sounds>) => update((s) => ({ ...s, sounds: { ...s.sounds, ...patch } }));

  return (
    <SettingsGroup
      title="Sons da chamada"
      hint="Avisos sonoros quando alguém entra ou sai da chamada ou da transmissão que você assiste, e quando você muta o microfone ou o som."
    >
      <Toggle label="Tocar sons da chamada" checked={enabled} onChange={(v) => setSounds({ enabled: v })} />
      <div className={`mt-3 max-w-sm ${enabled ? '' : 'pointer-events-none opacity-50'}`}>
        <Slider label="Volume dos sons" value={volume} max={1} onChange={(v) => setSounds({ volume: v })} />
      </div>
      <p className="mt-5 mb-2 text-xs font-bold tracking-wide text-muted uppercase">Ouvir cada som</p>
      <div className="flex flex-wrap gap-2">
        {SAMPLES.map(({ kind, label }) => (
          <button
            key={kind}
            type="button"
            disabled={!enabled}
            onClick={() => playSound(kind, { volume, outputDeviceId: settings.voice.outputDeviceId })}
            className="rounded-md bg-elevated px-3 py-1.5 text-sm hover:bg-hover disabled:opacity-50"
          >
            {label}
          </button>
        ))}
      </div>
    </SettingsGroup>
  );
}

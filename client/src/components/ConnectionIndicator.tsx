import { type ConnectionQuality, describeQuality, type QualityLevel } from '@shared/connection-quality';

const BARS: Record<QualityLevel, { lit: number; color: string }> = {
  good: { lit: 3, color: 'bg-online' },
  fair: { lit: 2, color: 'bg-idle' },
  poor: { lit: 1, color: 'bg-dnd' },
};

function ownDescription(level: QualityLevel): string {
  if (level === 'good') return 'Sua conexão parece boa';
  if (level === 'fair') return 'Sua conexão parece oscilar: parte da chamada está com problema';
  return 'Sua conexão parece ruim: a maioria da chamada está com problema';
}

/**
 * Três barrinhas com a qualidade da conexão de voz com uma pessoa (o ping, a perda de pacotes e a oscilação medidos por
 * você). No seu próprio nome, mostra se o problema parece ser seu: a maioria das pessoas da chamada está ruim para você.
 */
export function ConnectionIndicator({ quality, own = false }: { quality: ConnectionQuality; own?: boolean }) {
  const { lit, color } = BARS[quality.level];
  const label = own ? ownDescription(quality.level) : describeQuality(quality);
  return (
    <span role="img" aria-label={label} title={label} className="inline-flex h-3.5 shrink-0 items-end gap-px">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          aria-hidden
          style={{ height: `${5 + i * 3}px` }}
          className={`w-[3px] rounded-[1px] ${i < lit ? color : 'bg-faint/40'}`}
        />
      ))}
    </span>
  );
}

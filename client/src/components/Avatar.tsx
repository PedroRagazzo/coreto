import type { PresenceStatus } from '@shared/models';
import { initials } from '../lib/format';

export const STATUS_LABEL: Record<PresenceStatus, string> = {
  online: 'Online',
  idle: 'Ausente',
  dnd: 'Não perturbe',
  offline: 'Indisponível',
};

export const STATUS_DOT: Record<PresenceStatus, string> = {
  online: 'bg-online',
  idle: 'bg-idle',
  dnd: 'bg-dnd',
  offline: 'bg-offline',
};

const SIZES = {
  xs: 'h-6 w-6 text-[10px]',
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-16 w-16 text-xl',
} as const;

interface AvatarProps {
  name: string;
  color: string;
  status?: PresenceStatus;
  size?: keyof typeof SIZES;
  /** Cor da borda do indicador de status: deve casar com o fundo onde o avatar aparece. */
  ringClass?: string;
  /** Anel verde de quem está falando numa chamada. */
  speaking?: boolean;
}

export function Avatar({ name, color, status, size = 'md', ringClass = 'border-sidebar', speaking = false }: AvatarProps) {
  return (
    <span className="relative inline-flex shrink-0">
      <span
        aria-hidden
        className={`flex items-center justify-center rounded-full font-semibold text-white transition-shadow select-none ${SIZES[size]} ${
          speaking ? 'ring-2 ring-online ring-offset-2 ring-offset-sidebar' : ''
        }`}
        style={{ backgroundColor: color }}
      >
        {initials(name)}
      </span>
      {status && (
        <span
          title={STATUS_LABEL[status]}
          className={`absolute -right-0.5 -bottom-0.5 h-3.5 w-3.5 rounded-full border-[3px] ${ringClass} ${STATUS_DOT[status]}`}
        />
      )}
    </span>
  );
}

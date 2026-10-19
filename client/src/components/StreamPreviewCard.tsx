import type { Id } from '@shared/models';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRealtime } from '../state/realtime';
import { LiveBadge } from './StreamStage';

const CARD_WIDTH = 320;
const GAP = 8;
const MARGIN = 8;
/** A miniatura é mandada a cada ~8 s; olhar de novo um pouco antes mantém a prévia atual. */
const REFRESH_MS = 6000;

interface Props {
  /** Onde a linha de quem está ao vivo está na tela. */
  anchor: DOMRect;
  userId: Id;
  name: string;
  title: string | null;
  watchers: number;
}

/**
 * Prévia da transmissão ao passar o mouse (ou focar) em quem está ao vivo: uma miniatura da tela,
 * o que está sendo compartilhado e quantos assistem, sem precisar abrir a transmissão.
 */
export function StreamPreviewCard({ anchor, userId, name, title, watchers }: Props) {
  const { actions } = useRealtime();
  const [image, setImage] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      void actions
        .streamPreview(userId)
        .then((next) => {
          if (cancelled) return;
          if (next) setImage(next);
          setLoaded(true);
        })
        .catch(() => !cancelled && setLoaded(true));
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // `actions` muda de identidade a cada renderização do estado; só o dono da transmissão importa aqui.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // À direita da lista, na altura da linha; se não couber embaixo, sobe.
  const left = Math.min(anchor.right + GAP, window.innerWidth - CARD_WIDTH - MARGIN);
  const estimatedHeight = 280;
  const top = Math.max(MARGIN, Math.min(anchor.top - 8, window.innerHeight - estimatedHeight - MARGIN));

  return createPortal(
    <div
      role="tooltip"
      style={{ left, top, width: CARD_WIDTH }}
      className="pointer-events-none fixed z-50 overflow-hidden rounded-lg border border-line bg-elevated shadow-xl"
    >
      <div className="relative aspect-video bg-black/40">
        {image ? (
          <img src={image} alt={`Prévia da tela de ${name}`} className="h-full w-full object-contain" />
        ) : (
          <div className="flex h-full items-center justify-center px-4 text-center text-xs text-faint">
            {loaded ? 'A prévia aparece em alguns segundos.' : 'Carregando a prévia…'}
          </div>
        )}
      </div>
      <div className="space-y-1 p-3">
        <div className="flex items-center gap-2">
          <LiveBadge />
          <span className="truncate text-sm font-semibold text-fg">{name}</span>
        </div>
        {title && <p className="truncate text-sm text-muted">{title}</p>}
        <p className="text-xs text-faint">
          {watchers === 0 ? 'Ninguém assistindo' : watchers === 1 ? '1 pessoa assistindo' : `${watchers} pessoas assistindo`}
          {' · clique para assistir'}
        </p>
      </div>
    </div>,
    document.body,
  );
}

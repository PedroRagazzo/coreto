import { CHANGELOG, unseenEntries, type ChangelogEntry } from '@shared/changelog';
import { useEffect, useState } from 'react';
import { loadSeenNews, markNewsSeen } from '../lib/news';
import { useRealtime } from '../state/realtime';
import { Modal } from './Modal';

/** Dá tempo de o app terminar de abrir antes de a janelinha aparecer. */
const SHOW_DELAY_MS = 1500;

/** As entradas de novidades, com o nome de cada uma em negrito. */
export function ChangelogList({ entries }: { entries: readonly ChangelogEntry[] }) {
  return (
    <div className="space-y-6">
      {entries.map((entry, index) => (
        <section key={entry.id} aria-label={entry.title}>
          {(entries.length > 1 || index > 0) && (
            <h3 className="mb-2 text-sm font-semibold text-muted">
              {entry.title} <span className="font-normal text-faint">· {formatEntryDate(entry.id)}</span>
            </h3>
          )}
          <ul className="space-y-3">
            {entry.items.map((item) => (
              <li key={item.title} className="text-sm leading-relaxed text-fg/90">
                <strong className="font-semibold text-fg">{item.title}.</strong> {item.text}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** "28 de outubro" a partir do id `AAAA-MM-DD`. */
function formatEntryDate(id: string): string {
  const date = new Date(`${id.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? id : date.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' });
}

/**
 * A janelinha "O que há de novo": aparece uma vez depois que o site atualiza, com o que a pessoa ainda não viu. Não
 * aparece no meio de uma chamada (espera ela acabar) nem antes de o app terminar de abrir.
 */
export function WhatsNew() {
  const { state } = useRealtime();
  // Calculado uma vez, ao abrir: o que fecharmos aqui não volta enquanto a página estiver aberta.
  const [entries] = useState(() => unseenEntries(CHANGELOG, loadSeenNews()));
  const [closed, setClosed] = useState(false);
  const [waited, setWaited] = useState(false);

  const calm = state.connection === 'ready' && !state.myVoice.channelId && !state.myVoice.connecting;
  useEffect(() => {
    if (!calm) return setWaited(false);
    const timer = setTimeout(() => setWaited(true), SHOW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [calm]);

  if (entries.length === 0 || closed || !calm || !waited) return null;
  const close = () => {
    markNewsSeen();
    setClosed(true);
  };
  return (
    <Modal title="O que há de novo" onClose={close}>
      <ChangelogList entries={entries} />
      <div className="mt-6 flex justify-end">
        <button type="button" data-autofocus onClick={close} className="rounded-md bg-accent px-5 py-2 text-sm font-semibold text-white hover:bg-accent-strong">
          Entendi
        </button>
      </div>
    </Modal>
  );
}

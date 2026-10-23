import type { Message } from '@shared/models';
import { Permission } from '@shared/permissions';
import { ROULETTE_SPIN_MS, wheelAngle } from '@shared/polls';
import { PartyPopper } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useRealtime } from '../state/realtime';
import { can, displayNameOf } from '../state/selectors';
import { CreateRouletteDialog } from './CreateRouletteDialog';

const SIZE = 150; // a roda ocupa de -150 a 150 no desenho
const RADIUS = 138;
const COLORS = ['#e5534b', '#e8b339', '#3ecf6e', '#5b8def', '#b26be5', '#2cb5c9', '#f08c3a', '#d6619f'];
/** Acima disto os nomes ficam pequenos demais; a roda fica só com as cores e a lista embaixo diz tudo. */
const MAX_LABELED = 30;

/** Ponto na roda, a `radius` do centro, `degrees` no sentido horário a partir do alto. */
const point = (degrees: number, radius: number) => {
  const rad = (degrees * Math.PI) / 180;
  return { x: radius * Math.sin(rad), y: -radius * Math.cos(rad) };
};

function slicePath(from: number, to: number): string {
  const a = point(from, RADIUS);
  const b = point(to, RADIUS);
  const large = to - from > 180 ? 1 : 0;
  return `M0 0 L${a.x.toFixed(2)} ${a.y.toFixed(2)} A${RADIUS} ${RADIUS} 0 ${large} 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)} Z`;
}

/** A cor da fatia; a última nunca repete a da primeira, que fica ao lado dela. */
function sliceColor(index: number, count: number): string {
  if (index === count - 1 && count > 1 && index % COLORS.length === 0) return COLORS[COLORS.length - 1]!;
  return COLORS[index % COLORS.length]!;
}

/**
 * A roleta de uma mensagem. O servidor sorteia a opção quando alguém gira; aqui só se anima a roda até ela. Quem vê a
 * mensagem depois do giro (ou rolando o histórico) a encontra já parada no resultado.
 */
export function RouletteCard({ message }: { message: Message }) {
  const { state, actions } = useRealtime();
  const roulette = message.roulette!;
  const { options, result } = roulette;
  const count = options.length;
  const fresh = Boolean(state.freshSpins[message.id]);

  // Onde a roda cai dentro da fatia sorteada varia de um giro para outro, só por estética.
  const offset = useRef(Math.random() * 0.8 - 0.4);
  const [angle, setAngle] = useState(() => (result !== null && !fresh ? wheelAngle(result, count, offset.current) : 0));
  const [transition, setTransition] = useState(0);
  const [revealed, setRevealed] = useState(result !== null && !fresh);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [again, setAgain] = useState(false);

  useEffect(() => {
    if (result === null) return;
    const target = wheelAngle(result, count, offset.current);
    if (!fresh) {
      setTransition(0);
      setAngle(target);
      setRevealed(true);
      return;
    }
    // Começa parada e, no quadro seguinte, gira até o resultado.
    setRevealed(false);
    setTransition(0);
    setAngle(0);
    const frame = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        setTransition(ROULETTE_SPIN_MS);
        setAngle(target);
      }),
    );
    const done = setTimeout(() => setRevealed(true), ROULETTE_SPIN_MS + 150);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(done);
    };
    // `fresh` só importa no momento em que o resultado chega.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  const spinning = result !== null && !revealed;
  const spinner = roulette.spunById ? displayNameOf(state.snapshot, state.users, roulette.spunById) : null;
  const canSend = state.activeSpaceId === null || can(state.snapshot, message.channelId, Permission.SEND_MESSAGES);
  const sliceDegrees = 360 / count;
  const maxFont = Math.max(7, Math.min(13, sliceDegrees * 0.9));
  /** O tamanho da letra e o texto de cada fatia: a letra encolhe até o nome caber entre a borda e o centro; só então corta. */
  const labelFor = (text: string) => {
    const room = RADIUS - 10 - 24;
    const size = Math.max(7, Math.min(maxFont, room / (text.length * 0.56)));
    const maxChars = Math.floor(room / (size * 0.56));
    return { size, label: text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text };
  };

  async function spin() {
    setBusy(true);
    setError(null);
    setError(await actions.spinRoulette(message.id));
    setBusy(false);
  }

  return (
    <div className="mt-2 w-full max-w-sm rounded-lg border border-line bg-rail/60 p-3">
      <div className="relative mx-auto w-full max-w-[300px]">
        <svg viewBox={`${-SIZE} ${-SIZE} ${SIZE * 2} ${SIZE * 2}`} className="block w-full" role="img" aria-label={`Roleta com ${count} opções`}>
          <g
            style={{
              transform: `rotate(${angle}deg)`,
              transformOrigin: '0 0',
              transition: transition ? `transform ${transition}ms cubic-bezier(0.12, 0.7, 0.18, 1)` : 'none',
            }}
          >
            {options.map((text, i) => {
              const from = i * sliceDegrees;
              const to = (i + 1) * sliceDegrees;
              const middle = (from + to) / 2;
              const dim = revealed && result !== null && result !== i;
              const { size, label } = labelFor(text);
              return (
                <g key={i} opacity={dim ? 0.35 : 1} style={{ transition: 'opacity 400ms' }}>
                  <path d={slicePath(from, to)} fill={sliceColor(i, count)} stroke="rgba(0,0,0,0.35)" strokeWidth={1} />
                  <title>{text}</title>
                  {count <= MAX_LABELED && (
                    <text
                      transform={`rotate(${middle - 90})`}
                      x={RADIUS - 10}
                      y={size * 0.35}
                      textAnchor="end"
                      fontSize={size}
                      fontWeight={600}
                      fill="#fff"
                      stroke="rgba(0,0,0,0.45)"
                      strokeWidth={0.6}
                      paintOrder="stroke"
                    >
                      {label}
                    </text>
                  )}
                </g>
              );
            })}
            <circle r={14} fill="var(--color-panel, #222)" stroke="rgba(255,255,255,0.5)" strokeWidth={2} />
          </g>
          {/* O ponteiro fica parado no alto. */}
          <polygon points="-11,-149 11,-149 0,-122" fill="#fff" stroke="rgba(0,0,0,0.6)" strokeWidth={2} strokeLinejoin="round" />
        </svg>
      </div>

      {revealed && result !== null ? (
        <div className="mt-2 text-center" aria-live="polite">
          <p className="flex items-center justify-center gap-1.5 text-lg font-bold break-words">
            <PartyPopper size={20} className="shrink-0 text-idle" aria-hidden />
            <span>{options[result]}</span>
          </p>
          <p className="mt-0.5 text-xs text-faint">{spinner ? `Girada por ${spinner}` : 'Girada'}</p>
          {canSend && (
            <button type="button" onClick={() => setAgain(true)} className="mt-2 text-xs text-muted hover:text-fg hover:underline">
              Nova roleta com essas opções
            </button>
          )}
        </div>
      ) : spinning ? (
        <p className="mt-2 text-center text-sm text-muted" aria-live="polite">
          Girando…
        </p>
      ) : (
        <div className="mt-2 text-center">
          <button
            type="button"
            disabled={busy}
            onClick={() => void spin()}
            className="rounded-md bg-accent px-5 py-1.5 text-sm font-semibold text-white hover:bg-accent-strong disabled:opacity-50"
          >
            Girar
          </button>
          <p className="mt-1 text-xs text-faint">Qualquer pessoa do canal pode girar, uma vez só.</p>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-1 text-center text-xs text-dnd">
          {error}
        </p>
      )}

      <details className="mt-2 text-xs text-muted">
        <summary className="cursor-pointer select-none hover:text-fg">{count} opções</summary>
        <ol className="mt-1 list-decimal space-y-0.5 pl-5">
          {options.map((text, i) => (
            <li key={i} className={revealed && result === i ? 'font-semibold text-fg' : undefined}>
              {text}
            </li>
          ))}
        </ol>
      </details>

      {again && (
        <CreateRouletteDialog
          targetId={message.channelId}
          initial={{ title: message.content === 'Roleta' ? '' : message.content, options }}
          onClose={() => setAgain(false)}
        />
      )}
    </div>
  );
}

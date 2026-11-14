import { type DiagnosticCheck, type DiagnosticReport, formatReport, summarizeReport, type Verdict } from '@shared/diagnostics';
import { Check, CircleCheck, CircleX, Copy, Info, LoaderCircle, Stethoscope, TriangleAlert } from 'lucide-react';
import { useRef, useState } from 'react';
import { MIC_TEST_MS, runDiagnostics } from '../../lib/diagnostics';
import { useRealtime } from '../../state/realtime';
import { useSettings } from '../../state/settings';
import { SettingsGroup } from './SettingsModal';

/** A ordem e os nomes dos testes, para a lista já aparecer inteira enquanto eles rodam. */
const STEPS: { id: DiagnosticCheck['id']; title: string }[] = [
  { id: 'app', title: 'Este computador' },
  { id: 'server', title: 'Servidor do Coreto' },
  { id: 'mic', title: 'Microfone' },
  { id: 'network', title: 'Rede das chamadas' },
  { id: 'video', title: 'Transmissão de tela' },
  { id: 'call', title: 'Chamada de agora' },
];

const VERDICT_STYLE: Record<Verdict, { icon: typeof Info; color: string; label: string }> = {
  ok: { icon: CircleCheck, color: 'text-online', label: 'Tudo certo' },
  warn: { icon: TriangleAlert, color: 'text-idle', label: 'Atenção' },
  fail: { icon: CircleX, color: 'text-dnd', label: 'Problema' },
  info: { icon: Info, color: 'text-muted', label: 'Informação' },
};

/**
 * Testa o microfone, a internet, o servidor e as chamadas, explica o que achou em palavras simples e deixa copiar tudo para
 * mandar a quem está ajudando (o texto não leva senha, endereço IP, nomes nem mensagens).
 */
export function DiagnosticsSettings() {
  const { state, actions } = useRealtime();
  const { settings } = useSettings();
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<Partial<Record<DiagnosticCheck['id'], DiagnosticCheck | 'running'>>>({});
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [micDb, setMicDb] = useState<number | null>(null);
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const run = async () => {
    setRunning(true);
    setReport(null);
    setResults({});
    setMicDb(null);
    setCopied(null);
    const { quality, myVoice, connectionError } = stateRef.current;
    try {
      const finished = await runDiagnostics({
        prefs: settings.voice,
        probeServer: actions.probeServer,
        probeIceServers: actions.probeIceServers,
        connectionError,
        call: { inCall: Boolean(myVoice.channelId), peers: Object.values(quality) },
        onStep: (step) => setResults((prev) => ({ ...prev, [step.id]: step.state === 'running' ? 'running' : step.check })),
        onMicLevel: setMicDb,
      });
      setReport(finished);
    } finally {
      setRunning(false);
      setMicDb(null);
    }
  };

  const copy = async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(formatReport(report));
      setCopied('yes');
    } catch {
      // Sem permissão para a área de transferência: o texto abaixo dá para selecionar e copiar à mão.
      setCopied('no');
    }
  };

  const summary = report ? summarizeReport(report) : null;

  return (
    <>
      <SettingsGroup
        title="Teste de conexão"
        hint="Mede a sua internet, o servidor, o microfone e as chamadas, e diz o que está errado. Leva uns 10 segundos. Fale algo durante o teste do microfone."
      >
        <button
          type="button"
          onClick={() => void run()}
          disabled={running}
          className="flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-strong disabled:opacity-60"
        >
          {running ? <LoaderCircle size={16} className="animate-spin" /> : <Stethoscope size={16} />}
          {running ? 'Testando…' : report ? 'Testar de novo' : 'Rodar diagnóstico'}
        </button>
      </SettingsGroup>

      {(running || report) && (
        <SettingsGroup title={summary ? `Resultado: ${summary.text}` : 'Testando'}>
          <ul aria-label="Resultados do diagnóstico" className="space-y-3">
            {STEPS.map(({ id, title }) => {
              const result = results[id];
              return (
                <li key={id} className="rounded-md border border-line bg-rail p-3" data-check={id}>
                  {result === undefined || result === 'running' ? (
                    <div className="flex items-center gap-2 text-sm text-muted">
                      {result === 'running' ? <LoaderCircle size={16} className="animate-spin" /> : <span className="inline-block w-4" />}
                      <span className="font-semibold">{title}</span>
                      <span>{result === 'running' ? 'testando…' : 'esperando'}</span>
                      {id === 'mic' && result === 'running' && <MicMeter db={micDb} />}
                    </div>
                  ) : (
                    <CheckResult check={result} />
                  )}
                </li>
              );
            })}
          </ul>
        </SettingsGroup>
      )}

      {report && (
        <SettingsGroup
          title="Mandar para quem está ajudando"
          hint="Copia o resultado inteiro em texto. Ele não leva senha, endereço IP, nomes nem mensagens."
        >
          <button
            type="button"
            onClick={() => void copy()}
            className="flex items-center gap-2 rounded-md bg-elevated px-4 py-2 text-sm font-semibold hover:bg-hover"
          >
            {copied === 'yes' ? <Check size={16} /> : <Copy size={16} />}
            {copied === 'yes' ? 'Copiado!' : 'Copiar diagnóstico'}
          </button>
          {copied === 'no' && <p className="mt-2 text-sm text-dnd">O navegador não deixou copiar. Selecione o texto abaixo e copie com Ctrl+C.</p>}
          <details className="mt-3" open={copied === 'no'}>
            <summary className="cursor-pointer text-sm text-muted">Ver o texto que será copiado</summary>
            <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-rail p-3 text-xs whitespace-pre-wrap text-muted select-text">
              {formatReport(report)}
            </pre>
          </details>
        </SettingsGroup>
      )}
    </>
  );
}

function CheckResult({ check }: { check: DiagnosticCheck }) {
  const { icon: Icon, color, label } = VERDICT_STYLE[check.verdict];
  return (
    <>
      <div className="flex items-start gap-2">
        <Icon size={18} className={`mt-0.5 shrink-0 ${color}`} aria-label={label} role="img" />
        <div className="min-w-0 flex-1">
          <p className="text-sm">
            <span className="font-semibold">{check.title}</span>
            <span className="text-muted">: {check.summary}</span>
          </p>
          {check.advice && <p className="mt-1 text-sm text-fg">{check.advice}</p>}
        </div>
      </div>
      {check.details.length > 0 && (
        <details className="mt-2 ml-6">
          <summary className="cursor-pointer text-xs text-faint">Detalhes</summary>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
            {check.details.map(([name, value]) => (
              <div key={name} className="contents">
                <dt className="text-faint">{name}</dt>
                <dd className="min-w-0 break-words text-muted">{value}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </>
  );
}

/** O nível da voz durante o teste do microfone, de −80 a 0 dB. */
function MicMeter({ db }: { db: number | null }) {
  const width = db === null ? 0 : Math.min(1, Math.max(0, (db + 80) / 80));
  return (
    <span aria-label={`Nível do microfone no diagnóstico (${MIC_TEST_MS / 1000} s)`} role="meter" aria-valuemin={-80} aria-valuemax={0} aria-valuenow={db === null ? -80 : Math.round(db)} className="ml-2 inline-block h-2 w-32 overflow-hidden rounded-full bg-elevated align-middle">
      <span className="block h-full rounded-full bg-online transition-[width] duration-75" style={{ width: `${width * 100}%` }} />
    </span>
  );
}

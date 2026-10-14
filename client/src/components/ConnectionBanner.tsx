import { useRealtime } from '../state/realtime';

export function ConnectionBanner() {
  const { state } = useRealtime();
  if (state.connection === 'ready' && !state.connectionError) return null;

  const message =
    state.connection === 'connecting'
      ? 'Conectando ao servidor…'
      : state.connection === 'disconnected'
        ? 'Sem conexão. Tentando reconectar…'
        : state.connectionError;

  return (
    <div
      role="status"
      className={`shrink-0 px-4 py-1.5 text-center text-sm font-medium ${
        state.connection === 'disconnected' ? 'bg-dnd/20 text-dnd' : 'bg-idle/15 text-idle'
      }`}
    >
      {message}
      {state.connection === 'disconnected' && state.connectionError && (
        <span className="ml-2 text-xs opacity-80">({state.connectionError})</span>
      )}
    </div>
  );
}

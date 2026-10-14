import { isValidPin, MAX_DISPLAY_NAME, normalizeDisplayName } from '@shared/names';
import { useState, type FormEvent } from 'react';
import { login, type Identity } from '../lib/identity';

export function LoginScreen({ onLogin }: { onLogin: (identity: Identity) => void }) {
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ready = Boolean(normalizeDisplayName(name)) && isValidPin(pin);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    const res = await login({ name, pin });
    setBusy(false);
    if (res.ok) onLogin({ token: res.token });
    else {
      setError(res.error);
      if (res.code === 'wrong_pin') setPin('');
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-rail p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl bg-panel p-8 shadow-2xl">
        <h1 className="text-2xl font-bold">Coreto</h1>
        <p className="mt-1 text-muted">Comunidades, conversas e salas de voz.</p>

        <label htmlFor="login-name" className="mt-6 block text-xs font-semibold tracking-wide text-muted uppercase">
          Nome
        </label>
        <input
          id="login-name"
          autoFocus
          autoComplete="username"
          value={name}
          maxLength={MAX_DISPLAY_NAME}
          onChange={(e) => setName(e.target.value)}
          className="mt-2 w-full rounded-md bg-rail px-3 py-2.5 text-fg outline-none focus:ring-2 focus:ring-accent"
          placeholder="Seu nome"
        />

        <label htmlFor="login-pin" className="mt-4 block text-xs font-semibold tracking-wide text-muted uppercase">
          PIN de 4 números
        </label>
        <input
          id="login-pin"
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          value={pin}
          // Sem maxLength: ele conta letras que ainda vão ser descartadas e bloquearia os números seguintes.
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
          className="mt-2 w-full rounded-md bg-rail px-3 py-2.5 tracking-[0.5em] text-fg outline-none focus:ring-2 focus:ring-accent"
          placeholder="••••"
        />

        <p className="mt-3 text-xs text-faint">
          Primeira vez? Escolha um nome e um PIN e a conta é criada na hora. Depois disso este navegador fica sempre conectado.
        </p>
        {error && (
          <p role="alert" className="mt-3 text-sm text-dnd">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={!ready || busy}
          className="mt-6 w-full rounded-md bg-accent py-2.5 font-semibold text-white hover:bg-accent-strong disabled:opacity-50"
        >
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}

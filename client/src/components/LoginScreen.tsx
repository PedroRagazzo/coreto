import { useState } from 'react';

const MAX_NAME = 32;

export function LoginScreen({ onSubmit }: { onSubmit: (displayName: string) => void }) {
  const [name, setName] = useState('');
  const trimmed = name.trim();

  return (
    <div className="flex min-h-dvh items-center justify-center bg-rail p-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (trimmed) onSubmit(trimmed);
        }}
        className="w-full max-w-sm rounded-xl bg-panel p-8 shadow-2xl"
      >
        <h1 className="text-2xl font-bold">Coreto</h1>
        <p className="mt-1 text-muted">Comunidades, conversas e salas de voz.</p>

        <label htmlFor="display-name" className="mt-6 block text-xs font-semibold tracking-wide text-muted uppercase">
          Como quer ser chamado?
        </label>
        <input
          id="display-name"
          autoFocus
          value={name}
          maxLength={MAX_NAME}
          onChange={(e) => setName(e.target.value)}
          className="mt-2 w-full rounded-md bg-rail px-3 py-2.5 text-fg outline-none focus:ring-2 focus:ring-accent"
          placeholder="Seu nome"
        />
        <button
          type="submit"
          disabled={!trimmed}
          className="mt-6 w-full rounded-md bg-accent py-2.5 font-semibold text-white hover:bg-accent-strong disabled:opacity-50"
        >
          Entrar
        </button>
      </form>
    </div>
  );
}

export interface Identity {
  token: string;
  displayName: string;
}

const STORAGE_KEY = 'coreto.identity';

/** Identidade provisória guardada no navegador (o servidor a trata como login). */
export function loadIdentity(): Identity | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Identity> | null;
    if (typeof parsed?.token === 'string' && typeof parsed.displayName === 'string') {
      return { token: parsed.token, displayName: parsed.displayName };
    }
  } catch {
    // Armazenamento indisponível ou corrompido: pede o nome de novo.
  }
  return null;
}

export function createIdentity(displayName: string): Identity {
  const identity: Identity = { token: crypto.randomUUID(), displayName };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  } catch {
    // Sem armazenamento a sessão vale só até recarregar a página.
  }
  return identity;
}

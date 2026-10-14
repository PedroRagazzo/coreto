import type { LoginRequest, LoginResponse } from '@shared/protocol';
import { SERVER_URL } from './socket';

/** Sessão guardada no navegador. Ela não expira: a pessoa fica sempre logada. */
export interface Identity {
  token: string;
}

const STORAGE_KEY = 'coreto.identity';

export function loadIdentity(): Identity | null {
  try {
    // Versões antigas também guardavam o nome; só o token importa.
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Identity> | null;
    return typeof parsed?.token === 'string' ? { token: parsed.token } : null;
  } catch {
    return null;
  }
}

export function saveIdentity(identity: Identity): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  } catch {
    // Sem armazenamento a sessão vale só até recarregar a página.
  }
}

export function clearIdentity(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nada a limpar.
  }
}

/** Entra com nome e PIN (cria a conta se o nome estiver livre). */
export async function login(request: LoginRequest): Promise<LoginResponse> {
  try {
    const res = await fetch(`${SERVER_URL}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });
    return (await res.json()) as LoginResponse;
  } catch {
    return { ok: false, code: 'invalid_input', error: 'Não foi possível falar com o servidor. Ele está rodando?' };
  }
}

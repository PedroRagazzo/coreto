// Descobre se o servidor já está entregando uma versão do site mais nova que a que esta aba está rodando: o
// index.html sempre aponta para o arquivo principal do build (`/assets/index-<hash>.js`), e o hash muda a cada build.

const BUNDLE = /\/assets\/index-[\w-]+\.js/;

/** O arquivo principal da versão que esta aba está rodando (nulo no modo de desenvolvimento, que não tem hash). */
export function runningBundle(): string | null {
  const src = document.querySelector('script[type="module"][src*="/assets/index-"]')?.getAttribute('src');
  return src?.match(BUNDLE)?.[0] ?? null;
}

/** O arquivo principal que o servidor entrega agora, ou nulo se não deu para saber (servidor fora do ar, página de erro). */
export async function liveBundle(): Promise<string | null> {
  try {
    const res = await fetch('/', { cache: 'no-store', headers: { accept: 'text/html' } });
    if (!res.ok) return null;
    return (await res.text()).match(BUNDLE)?.[0] ?? null;
  } catch {
    return null;
  }
}

/** Tem texto escrito e ainda não enviado (mensagem, busca...)? Recarregar agora o perderia. */
export function hasUnsentText(): boolean {
  const el = document.activeElement;
  if (el instanceof HTMLTextAreaElement) return el.value.trim().length > 0;
  if (el instanceof HTMLInputElement && ['text', 'search', 'url', 'email'].includes(el.type)) return el.value.trim().length > 0;
  return (el instanceof HTMLElement && el.isContentEditable && (el.textContent ?? '').trim().length > 0) || false;
}

const RELOADED_KEY = 'coreto:reloaded-for';

/** Esta aba já recarregou por causa dessa versão? Evita recarregar em ciclo se, por algum motivo, ela não pegar. */
export function alreadyReloadedFor(bundle: string): boolean {
  try {
    return sessionStorage.getItem(RELOADED_KEY) === bundle;
  } catch {
    return false;
  }
}

export function markReloadedFor(bundle: string): void {
  try {
    sessionStorage.setItem(RELOADED_KEY, bundle);
  } catch {
    // Sem armazenamento: sem a proteção, mas o recarregamento ainda funciona.
  }
}

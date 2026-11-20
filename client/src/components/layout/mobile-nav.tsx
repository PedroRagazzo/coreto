// No celular (abaixo de 768 px) as três colunas viram duas telas: `nav` (espaços e canais) e `content` (a conversa, a chamada ou
// a transmissão). Este arquivo guarda qual das duas está à vista e liga o botão voltar do aparelho a ela.

import { ArrowLeft } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';

export type MobilePane = 'nav' | 'content';

interface MobileNav {
  pane: MobilePane;
  /** Vai para a conversa (ou chamada, ou transmissão). */
  showContent(): void;
  /** Volta para a lista de espaços e canais. */
  showNav(): void;
}

const PHONE_QUERY = '(max-width: 767px)';
/** Marca no histórico: "a conversa está aberta por cima da lista". Há no máximo uma por vez. */
const MARK = 'coretoPane';

const subscribePhone = (onChange: () => void) => {
  const media = window.matchMedia(PHONE_QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
};

/** A tela é de celular (largura abaixo de 768 px); acompanha o girar do aparelho. */
export function useIsPhone(): boolean {
  return useSyncExternalStore(subscribePhone, () => window.matchMedia(PHONE_QUERY).matches, () => false);
}

const MobileNavContext = createContext<MobileNav | null>(null);

export function MobileNavProvider({ children }: { children: ReactNode }) {
  // Ao abrir, a pessoa cai na conversa (como nos outros apps de chat); a lista fica a um toque de distância.
  const [pane, setPane] = useState<MobilePane>('content');
  const paneRef = useRef(pane);
  paneRef.current = pane;
  const phone = useIsPhone();
  const phoneRef = useRef(phone);
  phoneRef.current = phone;

  // O botão voltar do aparelho fecha a conversa (e leva à lista) em vez de sair do Coreto.
  useEffect(() => {
    if (phone && !history.state?.[MARK]) history.pushState({ [MARK]: true }, '');
    const onPop = () => setPane(history.state?.[MARK] ? 'content' : 'nav');
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [phone]);

  const showContent = useCallback(() => {
    if (paneRef.current !== 'nav') return;
    if (phoneRef.current) history.pushState({ [MARK]: true }, '');
    setPane('content');
  }, []);

  const showNav = useCallback(() => {
    if (history.state?.[MARK]) history.back();
    else setPane('nav');
  }, []);

  const value = useMemo(() => ({ pane, showContent, showNav }), [pane, showContent, showNav]);
  return <MobileNavContext.Provider value={value}>{children}</MobileNavContext.Provider>;
}

export function useMobileNav(): MobileNav {
  const value = useContext(MobileNavContext);
  if (!value) throw new Error('useMobileNav fora do MobileNavProvider');
  return value;
}

/** Botão do cabeçalho que volta à lista; só aparece no celular. */
export function BackToNav() {
  const { showNav } = useMobileNav();
  return (
    <button
      type="button"
      onClick={showNav}
      aria-label="Voltar à lista"
      title="Voltar à lista"
      className="-ml-2 shrink-0 rounded p-1.5 text-muted hover:bg-hover hover:text-fg md:hidden"
    >
      <ArrowLeft size={20} />
    </button>
  );
}

# App de celular — Fase 1: layout de celular — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O Coreto usável em tela de celular (abaixo de 768 px), no navegador e, depois, dentro do app, sem mudar nada no computador.

**Architecture:** Em telas estreitas as três colunas viram duas "telas" (`nav`: espaços + canais; `content`: conversa/chamada/transmissão), com um botão de voltar e o botão voltar do aparelho. Tudo é CSS responsivo (`md:`) mais um contexto pequeno de navegação; nenhuma mudança no servidor nem no estado do reducer.

**Tech Stack:** React 19 + Tailwind v4 (`client/`), Playwright (`e2e/`). Sem testes unitários no cliente: a prova é o e2e em janela de celular.

**Spec:** `docs/superpowers/specs/2026-11-20-app-de-celular-design.md` (fase 1). As fases 2 (casca Android) e 3 (iPhone) terão planos próprios.

## Global Constraints

- Celular = largura **abaixo de 768 px** (`md` do Tailwind; no computador nada muda).
- Mesma identidade visual do site; sem painel de membros fixo no celular (vira uma tela).
- Um só código: nada de segundo site ou rota separada.
- Texto da interface em português do Brasil; botões com `aria-label` (os testes acham por nome acessível).
- Todo texto novo que as pessoas notam vai em `shared/src/changelog.ts` só na entrega final (Task 6), uma entrada (cada texto < 300 caracteres).
- Os testes de navegador só rodam no CI (não há Postgres local): cada tarefa termina com `npm run typecheck` e, ao fim, push + `gh run watch`.

## Review Focus

- Entrar numa conta nova no celular: abrir direto na conversa do primeiro canal (não numa tela vazia).
- Botão voltar do aparelho/navegador na tela de conversa: vai para a lista, não sai do Coreto.
- Em chamada, com a conversa aberta: poder mutar e sair sem voltar à lista.
- Nenhuma tela com rolagem horizontal em 390×844 (lista, conversa, chamada, configurações, busca, membros).
- Girar o celular (844×390) ou abrir o teclado: o campo de mensagem continua visível.

---

### Task 1: Navegação de duas telas e o botão de voltar

**Files:**
- Create: `client/src/components/layout/mobile-nav.tsx`
- Modify: `client/src/components/layout/AppShell.tsx`, `client/src/components/SpaceRail.tsx` (só `rounded-3xl` → `rounded-none md:rounded-3xl`)
- Test: `e2e/tests/celular.spec.ts` (novo)

**Interfaces:**
- Produces (`mobile-nav.tsx`):
  `type MobilePane = 'nav' | 'content'`
  `MobileNavProvider({ children }): JSX.Element` — painel inicial `'content'`
  `useMobileNav(): { pane: MobilePane; showContent(): void; showNav(): void }`
  `useIsPhone(): boolean` (`matchMedia('(max-width: 767px)')`, atualiza ao girar)
  `BackToNav(): JSX.Element` — botão `md:hidden`, `aria-label="Voltar à lista"`, ícone `ArrowLeft`.

- [ ] **Step 1: Teste que falha** em `celular.spec.ts`, `test.describe('celular', ...)` com `openPerson(browser, 'Ana', { viewport: { width: 390, height: 844 } })`:
  `abre na conversa; Voltar à lista mostra espaços e canais; tocar num canal volta à conversa` — espera `textbox 'Mensagem para #geral'` visível; clica `button 'Voltar à lista'`; espera `navigation 'Espaços'` e `button 'geral'` visíveis e o textbox **oculto**; clica `button 'geral'` (exact, first); textbox visível.
  `no computador o botão Voltar à lista não existe` — viewport 1280×800: `getByRole('button', { name: 'Voltar à lista' })` fica oculto (`toBeHidden`), e a barra de espaços, a lista de canais e a conversa aparecem ao mesmo tempo.
- [ ] **Step 2: Rodar** `npm run typecheck` (passa) — o e2e falharia por falta do botão; confirmado no CI no Step 6.
- [ ] **Step 3: Implementar `mobile-nav.tsx`.** `showContent()` faz `history.pushState({ coretoPane: 'content' }, '')` se estiver em `nav`; `popstate` volta a `nav`; `showNav()` chama `history.back()` quando `history.state?.coretoPane === 'content'`, senão só troca o painel.
- [ ] **Step 4: Montar em `AppShell`.** Envolver tudo em `MobileNavProvider`; raiz `p-0 gap-0 md:p-3 md:gap-3`; um `div` `contents` (quando `pane === 'nav'`) ou `hidden md:contents` (quando `content`) em volta de `SpaceRail` e do `aside`; `aside` `min-w-0 flex-1 rounded-none md:w-64 md:flex-none md:rounded-3xl`; `main` `flex` quando `content`, `hidden md:flex` quando `nav`, `rounded-none md:rounded-3xl`.
- [ ] **Step 5: Voltar na conversa.** Em `ChatPanel.tsx`, `<BackToNav />` como primeiro item do `<header>`; esconder o tópico no celular (`hidden md:block` no separador e no `<p>` do tópico).
- [ ] **Step 6: Typecheck e commit** `git add client e2e && git commit -m "Layout de celular: duas telas (lista e conversa) com botão de voltar"`; no fim da fase, o CI confirma o e2e.

### Task 2: Entradas na conversa, chamada e transmissão

**Files:**
- Modify: `ChannelSidebar.tsx` (linhas ~174, ~205, ~315), `DirectMessages.tsx` (~59, ~119), `CallView.tsx` (header), `StreamStage.tsx` (headers ~103, ~265), `AppShell.tsx`
- Create: `client/src/components/layout/PhoneCallBar.tsx`
- Test: `e2e/tests/celular.spec.ts`

**Interfaces:**
- Consumes: `useMobileNav()` e `BackToNav` (Task 1); ações `selectChannel`, `selectDirect`, `openCall`, `watchStream`, `toggleMute`, `leaveVoice` (`state/realtime/types.ts`).
- Produces: `PhoneCallBar(): JSX.Element | null` — só no celular (`md:hidden`), visível quando `state.myVoice.channelId` e `pane === 'content'` e a visão da chamada **não** está aberta (`!state.callView`): nome do canal, botões `Ativar microfone`/`Desativar microfone` (`toggleMute`) e `Sair da chamada` (`leaveVoice`); tocar no nome volta à lista.

- [ ] **Step 1: Testes que falham** (viewport 390×844, duas pessoas quando precisar): (a) tocar num canal de texto, num DM e numa transmissão leva à conversa/palco; (b) com a chamada ativa e a conversa aberta, `PhoneCallBar` mostra o canal e `Desativar microfone` muda para `Ativar microfone` ao tocar; `Sair da chamada` some a barra; (c) abrir a visão da chamada e a transmissão mostra `Voltar à lista` no cabeçalho.
- [ ] **Step 2: Chamar `showContent()`** depois de cada ação nos cliques listados acima (a ação continua igual).
- [ ] **Step 3: Efeito em `AppShell`:** quando `state.callView` ou `state.stages.length` passam a abrir (mudança de falso para verdadeiro), `showContent()`.
- [ ] **Step 4: `<BackToNav />`** no cabeçalho de `CallView` e dos dois cabeçalhos de `StreamStage`; `PhoneCallBar` no topo do `main`, abaixo de `UpdateBanner`.
- [ ] **Step 5: Typecheck e commit** ("Celular: entrar na conversa, chamada e transmissão; barra da chamada").

### Task 3: Busca, fixadas e membros em tela cheia

**Files:**
- Modify: `ChatPanel.tsx`, `Search.tsx` (`SearchBox` e `SearchPanel`), `PinsPanel.tsx`, `MemberList.tsx`
- Test: `e2e/tests/celular.spec.ts`

**Interfaces:**
- Consumes: `useIsPhone()` (Task 1).

- [ ] **Step 1: Testes que falham** (390×844): os três botões do cabeçalho existem no celular (`Buscar mensagens`, `Mensagens fixadas`, `Mostrar membros`); `Mostrar membros` abre a lista de membros ocupando a tela (`complementary 'Membros'` visível e a conversa oculta) com um botão `Fechar` que volta à conversa; buscar um texto enviado mostra o resultado e `Fechar` volta; no computador nada muda (testes existentes).
- [ ] **Step 2: `ChatPanel`:** no celular, ícone de busca (`aria-label="Buscar mensagens"`) que abre o `SearchPanel` direto com o campo vazio (em vez da caixa do cabeçalho, que é `hidden md:block`); botão de membros sem o `hidden lg:block`; membros começam **fechados** no celular.
- [ ] **Step 3: Painéis laterais viram tela cheia no celular:** em `SearchPanel`, `PinsPanel` e `MemberList`, trocar `hidden … lg:flex/block` por `flex w-full lg:w-[…]` com `absolute inset-0 z-10 lg:static`, e um botão `Fechar` (`lg:hidden`) no topo de cada um.
- [ ] **Step 4: Typecheck e commit** ("Celular: busca, fixadas e membros em tela cheia").

### Task 4: Toque no lugar de passar o mouse

**Files:**
- Modify: `client/src/index.css`, `MessageList.tsx` (~215, ~331), `StreamStage.tsx` (~354, ~388), `SoundboardDialog.tsx` (~293), `ChannelSidebar.tsx` (~260), `ParticipantTile.tsx` (~36)
- Create: `client/src/lib/useLongPress.ts`
- Test: `e2e/tests/celular.spec.ts`

**Interfaces:**
- Produces: variante Tailwind `touch` (`@custom-variant touch (@media (hover: none));` em `index.css`);
  `useLongPress(onLongPress: (e: PointerEvent) => void, ms = 500): { onPointerDown, onPointerUp, onPointerLeave, onPointerCancel }` para espalhar em um elemento.

- [ ] **Step 1: Teste que falha** (390×844 com `hasTouch: true` no contexto; ampliar `openPerson` só se preciso): numa mensagem, os botões de ação (`Reagir`, `Responder`, `Editar`…) estão visíveis sem passar o mouse; ao tocar e segurar 600 ms num quadro de pessoa na chamada abre o menu de volume (`UserVolumeMenu`).
- [ ] **Step 2: `touch:opacity-100`** (e equivalentes) ao lado de cada `group-hover:opacity-100` listado: ações da mensagem, hora da mensagem, controles do palco de transmissão, botões do quadro de som.
- [ ] **Step 3: Pressão longa** com `useLongPress` onde existe `onContextMenu` (`ChannelSidebar` ~260, `ParticipantTile` ~36), chamando o mesmo `volumeMenu.open`.
- [ ] **Step 4: Typecheck e commit** ("Celular: ações visíveis ao toque e menu de volume por pressão longa").

### Task 5: Configurações em duas etapas

**Files:**
- Modify: `client/src/components/settings/SettingsModal.tsx`
- Test: `e2e/tests/celular.spec.ts`

- [ ] **Step 1: Teste que falha** (390×844): `Configurações` abre uma lista de categorias ocupando a tela; tocar numa categoria mostra só o conteúdo dela com `Voltar` que volta à lista; `Fechar` fecha tudo; no computador continua com as duas colunas (testes existentes).
- [ ] **Step 2: Implementar** estado `phoneView: 'list' | 'section'` (inicia `'list'` no celular, `useIsPhone()`); no celular o `nav` de categorias ocupa a tela inteira (`w-full`, sem o `w-60`/`py-12`) e o conteúdo da seção ocupa a tela com um botão `Voltar` no topo.
- [ ] **Step 3: Typecheck e commit** ("Celular: configurações em duas etapas").

### Task 6: Ajustes de tela de celular e entrega da fase

**Files:**
- Modify: `client/index.html`, `client/src/index.css`, `MessageInput.tsx`, `shared/src/changelog.ts`
- Test: `e2e/tests/celular.spec.ts`

- [ ] **Step 1: Testes que falham:** em 390×844, com a lista, a conversa, a chamada, as configurações, a busca e os membros abertos, `document.documentElement.scrollWidth <= window.innerWidth` (sem rolagem horizontal); em 844×390 (de lado) o `textbox 'Mensagem para #geral'` continua visível.
- [ ] **Step 2: `index.html`:** `<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content" />` e `<meta name="theme-color" content="#0b0b0b" />`.
- [ ] **Step 3: `index.css`:** respeitar as áreas seguras (`padding: env(safe-area-inset-*)` na raiz do app no celular); campos de texto com `font-size: 16px` abaixo de 768 px (o iPhone dá zoom em campos menores); `overscroll-behavior: none` no `body`.
- [ ] **Step 4: Entrada nas Novidades** (id `AAAA-MM-DD`, título "O Coreto no celular", texto simples: "Abra o Coreto no navegador do celular: agora ele cabe na tela, com a lista de canais, a conversa e a chamada em telas separadas").
- [ ] **Step 5: Verificar de verdade:** `npm run typecheck`, push, `gh run watch` (CI verde incluindo `celular.spec.ts`), deploy, e conferir no Brave com a janela redimensionada para celular (`resize_window` 390×844) a lista, a conversa, a chamada e as configurações.
- [ ] **Step 6: Commit e push** ("Celular: ajustes de tela, áreas seguras e Novidades").

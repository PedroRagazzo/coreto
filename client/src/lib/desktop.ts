// Ponte com o app de desktop (desktop/src/preload.cjs). No navegador, `desktop` é `null`.

import type { KeybindAction } from './keybinds';

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'latest'
  | 'error'
  /** Rodando sem instalador (desenvolvimento): não há o que atualizar. */
  | 'unsupported';

export interface UpdateState {
  status: UpdateStatus;
  /** Versão nova (disponível, baixando ou pronta). */
  version?: string;
  /** Progresso do download, 0 a 100. */
  percent?: number;
  error?: string;
  /** Quando foi a última verificação (ISO). */
  checkedAt?: string;
}

/** Som de um programa só (Windows). PCM de 16 bits, estéreo, 48 kHz, intercalado. */
export interface AppAudioBridge {
  /** Recebe o som da captura em andamento; devolve a função que cancela. */
  subscribe(onData: (id: number, chunk: Uint8Array) => void, onEnd: (id: number) => void): () => void;
  /** Id da captura que o último pedido de tela iniciou, ou `null` se não houve (a tela veio sem som). */
  active(): Promise<number | null>;
  stop(id: number): void;
}

/**
 * Como um atalho ficou: `watcher` vale em qualquer programa, inclusive um jogo em tela cheia; `hotkey` vale com o Coreto em
 * segundo plano (atalho do Windows); `taken`, outro programa já usa a combinação; `off`, só vale com o Coreto em foco.
 */
export type KeyBindMode = 'watcher' | 'hotkey' | 'taken' | 'off';

export interface DesktopBridge {
  /** Versão do app instalado. */
  version: string;
  platform: string;
  /** Só no app de desktop do Windows com o helper de som por programa (0.5.0 em diante). */
  appAudio?: AppAudioBridge;
  /** O app tem o leitor de teclado nativo: os atalhos valem com um jogo em primeiro plano (0.7.0 em diante). */
  keyWatcher?: boolean;
  /** Nome da tela ou janela escolhida no seletor, para mostrar o que está sendo compartilhado. Ausente antes da 0.5.1. */
  getCaptureName?(): Promise<string | null>;
  getUpdateState(): Promise<UpdateState>;
  checkForUpdates(): Promise<UpdateState>;
  /** Fecha o app, instala a versão baixada e abre de novo. */
  installUpdate(): void;
  onUpdateState(listener: (state: UpdateState) => void): () => void;
  /** `null` quando não dá para configurar (desenvolvimento). */
  getOpenAtLogin(): Promise<boolean | null>;
  setOpenAtLogin(open: boolean): Promise<boolean | null>;
  /** Fechar a janela esconde o app na bandeja (padrão) em vez de sair. Ausente no app 0.2.0. */
  getCloseToTray?(): Promise<boolean | null>;
  setCloseToTray?(enabled: boolean): Promise<boolean | null>;
  /**
   * Atalhos que valem no sistema inteiro, com o Coreto em segundo plano (formato de acelerador do
   * Electron, como "Ctrl+Shift+M"). Substitui os anteriores e resolve com os que conseguiu registrar
   * (falha se outro programa já usa a combinação). Ausente antes da versão 0.4.0.
   */
  setGlobalShortcuts?(accelerators: Record<KeybindAction, string | null>): Promise<Record<KeybindAction, boolean> | null>;
  /**
   * Os atalhos que valem fora do Coreto, no lugar de `setGlobalShortcuts` (0.7.0 em diante). Cada um leva a combinação no
   * formato do leitor de teclado (`spec`, qualquer combinação, até uma tecla sozinha) e, se tem modificador, o acelerador
   * do Electron, para o caso de o leitor não existir. Substitui os anteriores e resolve com como cada um ficou.
   */
  setKeyBinds?(binds: Record<KeybindAction, { spec: string | null; accelerator: string | null }>): Promise<Record<KeybindAction, KeyBindMode> | null>;
  /** Um atalho global foi apertado. */
  onShortcut?(listener: (action: KeybindAction) => void): () => void;
  /** Traz o Coreto para a frente (da bandeja ou minimizado), ao clicar numa notificação. Ausente antes da 0.6.0. */
  focusWindow?(): void;
}

export const desktop: DesktopBridge | null =
  (window as unknown as { coretoDesktop?: DesktopBridge }).coretoDesktop ?? null;

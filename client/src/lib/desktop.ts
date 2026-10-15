// Ponte com o app de desktop (desktop/src/preload.cjs). No navegador, `desktop` é `null`.

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

export interface DesktopBridge {
  /** Versão do app instalado. */
  version: string;
  platform: string;
  getUpdateState(): Promise<UpdateState>;
  checkForUpdates(): Promise<UpdateState>;
  /** Fecha o app, instala a versão baixada e abre de novo. */
  installUpdate(): void;
  onUpdateState(listener: (state: UpdateState) => void): () => void;
  /** `null` quando não dá para configurar (desenvolvimento). */
  getOpenAtLogin(): Promise<boolean | null>;
  setOpenAtLogin(open: boolean): Promise<boolean | null>;
}

export const desktop: DesktopBridge | null =
  (window as unknown as { coretoDesktop?: DesktopBridge }).coretoDesktop ?? null;

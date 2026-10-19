// Ponte entre o site do Coreto e o app de desktop: só o necessário para a tela
// "App de desktop" das configurações (versão, atualização, bandeja e abrir com o Windows)
// e os atalhos de mutar que valem com o Coreto em segundo plano.
// O site continua sem acesso ao Node; o processo principal confere a origem.
const { contextBridge, ipcRenderer } = require('electron');

const info = ipcRenderer.sendSync('desktop:info');

// Som da janela ou da tela compartilhada (ver "Som da janela" em main.js). Só existe quando o
// helper nativo está instalado.
const appAudio = info.appAudio
  ? {
      /** Recebe o PCM (16 bits, estéreo, 48 kHz) da captura em andamento. Devolve a função que cancela. */
      subscribe: (
        /** @type {(id: number, chunk: Uint8Array) => void} */ onData,
        /** @type {(id: number) => void} */ onEnd,
      ) => {
        const data = (/** @type {unknown} */ _event, /** @type {number} */ id, /** @type {Uint8Array} */ chunk) => onData(id, chunk);
        const end = (/** @type {unknown} */ _event, /** @type {number} */ id) => onEnd(id);
        ipcRenderer.on('desktop:app-audio', data);
        ipcRenderer.on('desktop:app-audio-end', end);
        return () => {
          ipcRenderer.removeListener('desktop:app-audio', data);
          ipcRenderer.removeListener('desktop:app-audio-end', end);
        };
      },
      /** Id da captura em andamento, ou `null` se o pedido de tela não trouxe som do helper. */
      active: () => ipcRenderer.invoke('desktop:app-audio-active'),
      stop: (/** @type {number} */ id) => ipcRenderer.send('desktop:app-audio-stop', id),
    }
  : undefined;

contextBridge.exposeInMainWorld('coretoDesktop', {
  version: info.version,
  platform: info.platform,
  appAudio,
  getCaptureName: () => ipcRenderer.invoke('desktop:capture-name'),
  getUpdateState: () => ipcRenderer.invoke('desktop:update-state'),
  checkForUpdates: () => ipcRenderer.invoke('desktop:check-updates'),
  installUpdate: () => ipcRenderer.send('desktop:install-update'),
  onUpdateState: (/** @type {(state: unknown) => void} */ listener) => {
    const handler = (/** @type {unknown} */ _event, /** @type {unknown} */ state) => listener(state);
    ipcRenderer.on('desktop:update-state', handler);
    return () => ipcRenderer.removeListener('desktop:update-state', handler);
  },
  getOpenAtLogin: () => ipcRenderer.invoke('desktop:get-open-at-login'),
  setOpenAtLogin: (/** @type {boolean} */ open) => ipcRenderer.invoke('desktop:set-open-at-login', Boolean(open)),
  getCloseToTray: () => ipcRenderer.invoke('desktop:get-close-to-tray'),
  setCloseToTray: (/** @type {boolean} */ enabled) => ipcRenderer.invoke('desktop:set-close-to-tray', Boolean(enabled)),
  setGlobalShortcuts: (/** @type {unknown} */ accelerators) => ipcRenderer.invoke('desktop:set-global-shortcuts', accelerators),
  onShortcut: (/** @type {(action: unknown) => void} */ listener) => {
    const handler = (/** @type {unknown} */ _event, /** @type {unknown} */ action) => listener(action);
    ipcRenderer.on('desktop:shortcut', handler);
    return () => ipcRenderer.removeListener('desktop:shortcut', handler);
  },
});

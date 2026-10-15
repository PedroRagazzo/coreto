// Ponte entre o site do Coreto e o app de desktop: só o necessário para a tela
// "App de desktop" das configurações (versão, atualização, bandeja e abrir com o Windows).
// O site continua sem acesso ao Node; o processo principal confere a origem.
const { contextBridge, ipcRenderer } = require('electron');

const info = ipcRenderer.sendSync('desktop:info');

contextBridge.exposeInMainWorld('coretoDesktop', {
  version: info.version,
  platform: info.platform,
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
});

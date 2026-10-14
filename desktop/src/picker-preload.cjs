// Ponte mínima entre o seletor de tela (página local) e o processo principal.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('coretoPicker', {
  sources: () => ipcRenderer.invoke('picker:sources'),
  choose: (/** @type {string | null} */ id) => ipcRenderer.send('picker:choose', id),
});

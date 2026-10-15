// @ts-check
// App de desktop do Coreto: uma janela que abre o servidor Coreto (como o app
// do Discord abre o discord.com). O site roda isolado, sem acesso ao Node; o
// app só acrescenta o que o navegador não dá sozinho: o seletor de tela, a
// permissão de microfone e câmera para o servidor certo e links no navegador.
//
// Endereço do servidor, por ordem: --url=..., CORETO_URL, coreto.config.json.
//
// Atualização: o app instalado procura versões novas nas releases do GitHub
// (latest.yml publicado pelo workflow de release) ao abrir e a cada 4 horas,
// baixa em segundo plano e avisa o site, que mostra "Reiniciar e atualizar".
// Para testar sem publicar: CORETO_UPDATE_TEST=<url de uma pasta com latest.yml>, com um
// dev-app-update.yml (provider: generic, url: a mesma) na pasta desktop/.

import { app, BrowserWindow, desktopCapturer, ipcMain, Menu, session, shell } from 'electron';
import updater from 'electron-updater';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** @returns {URL} */
function serverUrl() {
  const fromArg = process.argv.find((arg) => arg.startsWith('--url='))?.slice('--url='.length);
  const fromConfig = /** @type {{ url?: string }} */ (
    JSON.parse(readFileSync(join(app.getAppPath(), 'coreto.config.json'), 'utf8'))
  ).url;
  const url = new URL(fromArg ?? process.env.CORETO_URL ?? fromConfig ?? 'http://localhost:3001');
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`Endereço inválido: ${url}`);
  return url;
}

const SERVER = serverUrl();
/** Permissões que o site do Coreto pode pedir; as outras são negadas. */
const ALLOWED_PERMISSIONS = new Set(['media', 'display-capture', 'notifications', 'fullscreen', 'clipboard-sanitized-write']);

const isOurs = (/** @type {string} */ url) => {
  try {
    return new URL(url).origin === SERVER.origin;
  } catch {
    return false;
  }
};

const openOutside = (/** @type {string} */ url) => {
  const protocol = new URL(url).protocol;
  if (protocol === 'https:' || protocol === 'http:') void shell.openExternal(url);
};

// ── Atualização automática ───────────────────────────────────────────────────

const { autoUpdater } = updater;
const UPDATE_CHECK_MS = 4 * 60 * 60_000;
const UPDATE_TEST_FEED = process.env.CORETO_UPDATE_TEST;

/** @typedef {{ status: string; version?: string; percent?: number; error?: string; checkedAt?: string }} UpdateState */
/** @type {UpdateState} */
let updateState = { status: app.isPackaged || UPDATE_TEST_FEED ? 'idle' : 'unsupported' };

/** @param {Partial<UpdateState>} patch */
function setUpdateState(patch) {
  updateState = { ...updateState, ...patch };
  mainWindow?.webContents.send('desktop:update-state', updateState);
}

const checkForUpdates = async () => {
  if (updateState.status === 'unsupported' || updateState.status === 'ready') return;
  if (updateState.status === 'downloading' || updateState.status === 'checking') return;
  await autoUpdater.checkForUpdates().catch(() => {
    // o evento "error" já registrou o motivo
  });
};

function configureUpdater() {
  if (updateState.status === 'unsupported') return;
  if (UPDATE_TEST_FEED) {
    autoUpdater.forceDevUpdateConfig = true;
    autoUpdater.setFeedURL({ provider: 'generic', url: UPDATE_TEST_FEED });
  }
  autoUpdater.autoDownload = true;
  // Se a pessoa não reiniciar agora, instala ao fechar o app.
  autoUpdater.autoInstallOnAppQuit = true;
  const now = () => new Date().toISOString();
  autoUpdater.on('checking-for-update', () => setUpdateState({ status: 'checking', error: undefined }));
  autoUpdater.on('update-available', (info) => setUpdateState({ status: 'available', version: info.version, percent: 0 }));
  autoUpdater.on('download-progress', (progress) => setUpdateState({ status: 'downloading', percent: progress.percent }));
  autoUpdater.on('update-downloaded', (info) =>
    setUpdateState({ status: 'ready', version: info.version, percent: 100, checkedAt: now() }),
  );
  autoUpdater.on('update-not-available', () => setUpdateState({ status: 'latest', version: undefined, checkedAt: now() }));
  autoUpdater.on('error', (err) =>
    setUpdateState({ status: updateState.status === 'ready' ? 'ready' : 'error', error: err.message, checkedAt: now() }),
  );
  setTimeout(() => void checkForUpdates(), 5_000);
  setInterval(() => void checkForUpdates(), UPDATE_CHECK_MS).unref();
}

// ── Ponte com o site (preload.cjs) ───────────────────────────────────────────

/** O pedido veio da janela principal, com o site do Coreto carregado? */
const fromCoreto = (/** @type {Electron.IpcMainEvent | Electron.IpcMainInvokeEvent} */ event) =>
  mainWindow !== null && event.sender === mainWindow.webContents && isOurs(event.senderFrame?.url ?? '');

function registerBridge() {
  // Versão e sistema não são segredo; responde sempre (o preload espera a resposta).
  ipcMain.on('desktop:info', (event) => {
    event.returnValue = { version: app.getVersion(), platform: process.platform };
  });
  ipcMain.handle('desktop:update-state', (event) => (fromCoreto(event) ? updateState : null));
  ipcMain.handle('desktop:check-updates', async (event) => {
    if (!fromCoreto(event)) return null;
    await checkForUpdates();
    return updateState;
  });
  ipcMain.on('desktop:install-update', (event) => {
    // Silencioso e reabrindo o app no fim, como o Discord.
    if (fromCoreto(event) && updateState.status === 'ready') autoUpdater.quitAndInstall(true, true);
  });
  // Iniciar com o Windows só faz sentido no app instalado (em desenvolvimento registraria o electron.exe).
  ipcMain.handle('desktop:get-open-at-login', (event) =>
    fromCoreto(event) && app.isPackaged ? app.getLoginItemSettings().openAtLogin : null,
  );
  ipcMain.handle('desktop:set-open-at-login', (event, open) => {
    if (!fromCoreto(event) || !app.isPackaged) return null;
    app.setLoginItemSettings({ openAtLogin: Boolean(open) });
    return app.getLoginItemSettings().openAtLogin;
  });
}

// ── Posição e tamanho da janela entre aberturas ──────────────────────────────

const statePath = () => join(app.getPath('userData'), 'window.json');

/** @returns {{ width: number; height: number; x?: number; y?: number; maximized?: boolean }} */
function loadWindowState() {
  try {
    return JSON.parse(readFileSync(statePath(), 'utf8'));
  } catch {
    return { width: 1280, height: 800 };
  }
}

/** @param {BrowserWindow} win */
function saveWindowState(win) {
  try {
    writeFileSync(statePath(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() }));
  } catch {
    // Sem onde gravar, a janela só volta ao tamanho padrão.
  }
}

// ── Seletor de tela (getDisplayMedia não tem seletor próprio no Electron) ─────

/**
 * Mostra as telas e janelas para escolher, como o seletor do Discord.
 * @param {BrowserWindow} parent
 * @returns {Promise<string | null>} id da fonte escolhida, ou `null` se cancelou
 */
async function pickSource(parent) {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: true,
  });
  const picker = new BrowserWindow({
    parent,
    modal: true,
    width: 760,
    height: 560,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: 'Compartilhar tela',
    backgroundColor: '#191c21',
    autoHideMenuBar: true,
    show: false,
    webPreferences: { preload: join(here, 'picker-preload.cjs'), contextIsolation: true, sandbox: true },
  });
  const list = sources.map((s) => ({
    id: s.id,
    name: s.name,
    kind: s.id.startsWith('screen:') ? 'screen' : 'window',
    thumbnail: s.thumbnail.toDataURL(),
    icon: s.appIcon?.toDataURL() ?? null,
  }));

  return new Promise((resolve) => {
    let settled = false;
    const finish = (/** @type {string | null} */ id) => {
      if (settled) return;
      settled = true;
      ipcMain.removeHandler('picker:sources');
      ipcMain.removeAllListeners('picker:choose');
      if (!picker.isDestroyed()) picker.close();
      resolve(id);
    };
    ipcMain.handle('picker:sources', () => list);
    ipcMain.on('picker:choose', (event, id) => {
      if (event.sender !== picker.webContents) return;
      finish(typeof id === 'string' && list.some((s) => s.id === id) ? id : null);
    });
    picker.on('closed', () => finish(null));
    picker.once('ready-to-show', () => picker.show());
    void picker.loadFile(join(here, 'picker.html'));
  });
}

// ── Janela principal ─────────────────────────────────────────────────────────

/** @type {BrowserWindow | null} */
let mainWindow = null;

function createWindow() {
  const state = loadWindowState();
  const win = new BrowserWindow({
    ...state,
    minWidth: 940,
    minHeight: 560,
    title: 'Coreto',
    backgroundColor: '#121417',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });
  mainWindow = win;
  if (state.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.on('close', () => saveWindowState(win));

  // Links de fora (e anexos abertos em "nova aba") vão para o navegador padrão.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openOutside(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (isOurs(url)) return;
    event.preventDefault();
    openOutside(url);
  });

  // Sem servidor: uma página local explica e tenta de novo.
  win.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3 = navegação cancelada
    void win.loadFile(join(here, 'offline.html'), { query: { url: SERVER.href, erro: description } });
  });

  // Atalhos que o menu escondido levaria embora.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const ctrl = input.control || input.meta;
    if (input.key === 'F5' || (ctrl && input.key.toLowerCase() === 'r')) {
      event.preventDefault();
      void win.loadURL(SERVER.href);
    } else if (ctrl && input.shift && input.key.toLowerCase() === 'i') {
      event.preventDefault();
      win.webContents.toggleDevTools();
    }
  });

  void win.loadURL(SERVER.href);
}

function configureSession() {
  const ses = session.defaultSession;
  // Microfone, câmera, tela e notificações só para o servidor do Coreto.
  ses.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(isOurs(webContents.getURL()) && ALLOWED_PERMISSIONS.has(permission));
  });
  ses.setPermissionCheckHandler((_webContents, permission, origin) => isOurs(origin) && ALLOWED_PERMISSIONS.has(permission));

  /** Última escolha: se a captura com som falhar, o site pede de novo sem som e não precisa escolher outra vez. */
  /** @type {{ id: string; at: number } | null} */
  let lastChoice = null;
  const REUSE_CHOICE_MS = 10_000;

  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    // Recusar: o Electron lança um erro quando o callback vem sem vídeo, e é isso que recusa o pedido.
    const deny = () => {
      try {
        callback({});
      } catch {
        // pedido recusado
      }
    };
    if (!mainWindow || !isOurs(request.securityOrigin)) return deny();
    const reuse = lastChoice && !request.audioRequested && Date.now() - lastChoice.at < REUSE_CHOICE_MS;
    const id = reuse && lastChoice ? lastChoice.id : await pickSource(mainWindow);
    lastChoice = id ? { id, at: Date.now() } : null;
    if (!id) return deny();
    const [source] = (await desktopCapturer.getSources({ types: ['screen', 'window'] })).filter((s) => s.id === id);
    if (!source) return deny();
    // Som do sistema ("loopback") só existe no Windows e só para a tela inteira.
    const loopback = request.audioRequested && process.platform === 'win32' && id.startsWith('screen:');
    callback(loopback ? { video: source, audio: 'loopback' } : { video: source });
  });
}

// Uma instância só: abrir de novo traz a janela existente para a frente.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    configureSession();
    registerBridge();
    createWindow();
    configureUpdater();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

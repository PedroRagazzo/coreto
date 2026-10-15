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
//
// Bandeja: como o Discord, fechar a janela esconde o app na bandeja do Windows
// (uma chamada continua); o ícone traz de volta e o menu tem "Sair do Coreto".
// Aberto junto com o Windows (--hidden), começa direto na bandeja.

import { app, BrowserWindow, desktopCapturer, ipcMain, Menu, nativeImage, session, shell, Tray } from 'electron';
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
/** Argumento usado ao abrir junto com o Windows: começa escondido, só na bandeja. */
const HIDDEN_ARG = '--hidden';
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

// ── Preferências do app (as do site ficam no navegador) ──────────────────────

/** @typedef {{ closeToTray: boolean; trayHintShown: boolean }} DesktopPrefs */
const prefsPath = () => join(app.getPath('userData'), 'desktop.json');

/** @returns {DesktopPrefs} */
function loadPrefs() {
  /** @type {Partial<DesktopPrefs>} */
  let saved = {};
  try {
    saved = JSON.parse(readFileSync(prefsPath(), 'utf8'));
  } catch {
    // primeira vez: padrões
  }
  return {
    closeToTray: typeof saved.closeToTray === 'boolean' ? saved.closeToTray : true,
    trayHintShown: saved.trayHintShown === true,
  };
}

/** @type {DesktopPrefs} */
let prefs = { closeToTray: true, trayHintShown: false };

/** @param {Partial<DesktopPrefs>} patch */
function savePrefs(patch) {
  prefs = { ...prefs, ...patch };
  try {
    writeFileSync(prefsPath(), JSON.stringify(prefs));
  } catch {
    // sem onde gravar, vale até fechar o app
  }
}

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
  refreshTray();
}

const installUpdate = () => {
  // Silencioso e reabrindo o app no fim, como o Discord.
  if (updateState.status === 'ready') autoUpdater.quitAndInstall(true, true);
};

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
    if (fromCoreto(event)) installUpdate();
  });
  // Iniciar com o Windows só faz sentido no app instalado (em desenvolvimento registraria o electron.exe).
  // Aberto pelo Windows, o app começa escondido na bandeja.
  const loginItem = { args: [HIDDEN_ARG] };
  ipcMain.handle('desktop:get-open-at-login', (event) =>
    fromCoreto(event) && app.isPackaged ? app.getLoginItemSettings(loginItem).openAtLogin : null,
  );
  ipcMain.handle('desktop:set-open-at-login', (event, open) => {
    if (!fromCoreto(event) || !app.isPackaged) return null;
    app.setLoginItemSettings({ ...loginItem, openAtLogin: Boolean(open) });
    return app.getLoginItemSettings(loginItem).openAtLogin;
  });
  ipcMain.handle('desktop:get-close-to-tray', (event) => (fromCoreto(event) ? prefs.closeToTray : null));
  ipcMain.handle('desktop:set-close-to-tray', (event, enabled) => {
    if (!fromCoreto(event)) return null;
    savePrefs({ closeToTray: Boolean(enabled) });
    return prefs.closeToTray;
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

// ── Bandeja do Windows ───────────────────────────────────────────────────────

/** @type {Tray | null} */
let tray = null;
/** O app está saindo de verdade (menu "Sair", atualização, desligamento): a janela pode fechar. */
let quitting = false;

function showWindow() {
  if (!mainWindow) return createWindow(true);
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function refreshTray() {
  if (!tray) return;
  const ready = updateState.status === 'ready';
  tray.setToolTip(ready ? `Coreto — versão ${updateState.version} pronta para instalar` : 'Coreto');
  /** @type {Electron.MenuItemConstructorOptions} */
  const updateItem = ready
    ? { label: `Reiniciar e atualizar (${updateState.version})`, click: installUpdate }
    : {
        label: updateState.status === 'checking' ? 'Procurando atualizações…' : 'Procurar atualizações',
        enabled: !['unsupported', 'checking', 'downloading', 'available'].includes(updateState.status),
        click: () => void checkForUpdates(),
      };
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Abrir o Coreto', click: showWindow },
      { type: 'separator' },
      updateItem,
      { type: 'separator' },
      {
        label: 'Sair do Coreto',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

function createTray() {
  // tray.png tem 16 px; o Electron usa o tray@2x.png (32 px) sozinho em telas de alta densidade.
  tray = new Tray(nativeImage.createFromPath(join(here, 'assets', 'tray.png')));
  tray.on('click', showWindow);
  refreshTray();
}

// ── Janela principal ─────────────────────────────────────────────────────────

/** @type {BrowserWindow | null} */
let mainWindow = null;

/** @param {boolean} [visible] mostrar assim que carregar (falso ao abrir junto com o Windows) */
function createWindow(visible = true) {
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
      // Escondido na bandeja, o app continua numa chamada: nada de desacelerar os timers.
      backgroundThrottling: false,
    },
  });
  mainWindow = win;
  if (state.maximized) win.maximize();
  win.once('ready-to-show', () => {
    if (visible) win.show();
  });
  win.on('close', (event) => {
    saveWindowState(win);
    if (quitting || !prefs.closeToTray || !tray) return;
    // Fechar só esconde, como o Discord; "Sair do Coreto" no menu da bandeja fecha de vez.
    event.preventDefault();
    win.hide();
    if (!prefs.trayHintShown) {
      tray.displayBalloon({
        iconType: 'info',
        title: 'O Coreto continua aberto',
        content: 'Ele fica aqui na bandeja. Clique no ícone para voltar ou use o botão direito para sair.',
      });
      savePrefs({ trayHintShown: true });
    }
  });
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

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
  // Abrir de novo (atalho, menu Iniciar) traz a janela de volta, mesmo escondida na bandeja.
  app.on('second-instance', showWindow);
  // Sair pelo menu, pela atualização ou pelo desligamento do Windows: a janela pode fechar.
  app.on('before-quit', () => {
    quitting = true;
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    prefs = loadPrefs();
    configureSession();
    registerBridge();
    createTray();
    createWindow(!process.argv.includes(HIDDEN_ARG));
    configureUpdater();
    app.on('activate', showWindow);
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

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

import { app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain, Menu, nativeImage, session, shell, Tray } from 'electron';
import updater from 'electron-updater';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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

// ── Atalhos que valem com o app em segundo plano, ou com um jogo em primeiro plano ────────────

const SHORTCUT_ACTIONS = ['mute', 'deafen'];

// O Electron (`globalShortcut`, que usa RegisterHotKey) não alcança um jogo em tela cheia: o Windows não entrega
// esses atalhos a quem está atrás dele, e uma tecla sozinha, como "V", nem pode ser registrada. Quem vigia o teclado
// é native/coreto-keys.exe (Raw Input), que avisa quando a combinação é apertada, em qualquer programa. Se ele não
// existe (desenvolvimento, ou fora do Windows), as combinações com modificador seguem pelo `globalShortcut`.

const KEYS_HELPER = app.isPackaged
  ? join(process.resourcesPath, 'coreto-keys.exe')
  : join(here, '..', 'native', 'bin', 'coreto-keys.exe');
const keyWatcherAvailable = () => process.platform === 'win32' && existsSync(KEYS_HELPER);
/** O formato que o helper entende (ver shared/src/keybinds.ts, `toScanSpec`). Nada além disso vai para a entrada dele. */
const SCAN_SPEC = /^[0-9A-F]{2,4}(\|[0-9A-F]{2,4})*(\+[0-9A-F]{2,4}(\|[0-9A-F]{2,4})*){0,7}$/;
const KEY_WATCHER_MAX_RESTARTS = 5;

/** @type {import('node:child_process').ChildProcess | null} */
let keyWatcher = null;
/** Ação → combinação que o helper vigia agora. @type {Record<string, string>} */
let watchedBinds = {};
/** Ação → atalho do Electron que vale no lugar, se o helper cair de vez. @type {Record<string, string>} */
let fallbackAccelerators = {};
let keyWatcherRestarts = 0;

/** Manda ao site que a ação foi pedida. @param {string} action */
const fireShortcut = (action) => {
  if (SHORTCUT_ACTIONS.includes(action) && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('desktop:shortcut', action);
  }
};

function pushWatchedBinds() {
  const stdin = keyWatcher?.stdin;
  if (!stdin?.writable) return;
  for (const action of SHORTCUT_ACTIONS) stdin.write(`set ${action} ${watchedBinds[action] ?? ''}\n`);
}

function startKeyWatcher() {
  if (keyWatcher || !keyWatcherAvailable()) return;
  const child = spawn(KEYS_HELPER, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  keyWatcher = child;
  let pending = '';
  child.stdout?.on('data', (/** @type {Buffer} */ chunk) => {
    pending += chunk.toString();
    let end;
    while ((end = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, end).trim();
      pending = pending.slice(end + 1);
      if (line === 'ready') keyWatcherRestarts = 0;
      else if (line.startsWith('fire ')) fireShortcut(line.slice(5));
    }
    if (pending.length > 1024) pending = '';
  });
  child.stderr?.on('data', (/** @type {Buffer} */ line) => console.warn(`coreto-keys: ${line.toString().trim()}`));
  const lost = () => {
    if (keyWatcher !== child) return;
    keyWatcher = null;
    if (quitting || Object.keys(watchedBinds).length === 0) return;
    if (keyWatcherRestarts < KEY_WATCHER_MAX_RESTARTS) {
      keyWatcherRestarts++;
      setTimeout(() => {
        startKeyWatcher();
        pushWatchedBinds();
      }, keyWatcherRestarts * 1000).unref();
      return;
    }
    // Não subiu de jeito nenhum: ao menos as combinações com modificador seguem pelo Windows.
    console.warn('coreto-keys: o leitor de teclado não funciona; usando só os atalhos do sistema.');
    for (const [action, accelerator] of Object.entries(fallbackAccelerators)) {
      try {
        globalShortcut.register(accelerator, () => fireShortcut(action));
      } catch {
        // combinação que o Electron não reconhece
      }
    }
  };
  child.on('error', lost);
  child.on('exit', lost);
  pushWatchedBinds();
}

function stopKeyWatcher() {
  const child = keyWatcher;
  keyWatcher = null;
  if (!child) return;
  // Fechar a entrada é o aviso combinado para o helper parar; o kill é só garantia.
  child.stdin?.destroy();
  setTimeout(() => child.kill(), 1000).unref();
}

/**
 * O site pede os atalhos de mutar e de ensurdecer; cada pedido substitui os anteriores. Cada atalho vem com a
 * combinação no formato do helper (`spec`, qualquer combinação) e, se tem modificador, o acelerador do Electron
 * (`accelerator`), para o caso de o helper não existir. Responde como cada um ficou: `watcher` (vale em qualquer
 * programa, inclusive jogos), `hotkey` (vale com o Coreto em segundo plano), `taken` (outro programa já usa a
 * combinação) ou `off` (só vale com o Coreto em foco).
 * @param {unknown} binds
 */
function setKeyBinds(binds) {
  globalShortcut.unregisterAll();
  /** @type {Record<string, string>} */
  const result = { mute: 'off', deafen: 'off' };
  watchedBinds = {};
  fallbackAccelerators = {};
  for (const action of SHORTCUT_ACTIONS) {
    const item = binds && typeof binds === 'object' ? /** @type {Record<string, any>} */ (binds)[action] : null;
    const spec = typeof item?.spec === 'string' && SCAN_SPEC.test(item.spec) ? item.spec : null;
    const accelerator = typeof item?.accelerator === 'string' && item.accelerator.length <= 40 ? item.accelerator : null;
    if (accelerator) fallbackAccelerators[action] = accelerator;
    if (spec && keyWatcherAvailable()) {
      watchedBinds[action] = spec;
      result[action] = 'watcher';
    } else if (accelerator) {
      try {
        result[action] = globalShortcut.register(accelerator, () => fireShortcut(action)) ? 'hotkey' : 'taken';
      } catch {
        // combinação que o Electron não reconhece: fica sem atalho global
      }
    }
  }
  if (Object.keys(watchedBinds).length > 0) {
    keyWatcherRestarts = 0;
    startKeyWatcher();
    pushWatchedBinds();
  } else {
    stopKeyWatcher();
  }
  return result;
}

function registerBridge() {
  ipcMain.handle('desktop:set-key-binds', (event, binds) => (fromCoreto(event) ? setKeyBinds(binds) : null));
  // Versão e sistema não são segredo; responde sempre (o preload espera a resposta).
  ipcMain.on('desktop:info', (event) => {
    event.returnValue = {
      version: app.getVersion(),
      platform: process.platform,
      appAudio: appAudioAvailable(),
      keyWatcher: keyWatcherAvailable(),
    };
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
  // Qual captura de som está valendo (para o site saber se deve esperar o som do helper); parar uma captura.
  ipcMain.handle('desktop:app-audio-active', (event) => (fromCoreto(event) && appAudio ? appAudio.id : null));
  ipcMain.on('desktop:app-audio-stop', (event, id) => {
    if (fromCoreto(event) && typeof id === 'number') stopAppAudio(id);
  });
  ipcMain.handle('desktop:capture-name', (event) => (fromCoreto(event) && captureName ? captureName : null));
  ipcMain.on('desktop:focus-window', (event) => {
    if (fromCoreto(event)) showWindow();
  });
  ipcMain.handle('desktop:get-close-to-tray', (event) => (fromCoreto(event) ? prefs.closeToTray : null));
  ipcMain.handle('desktop:set-close-to-tray', (event, enabled) => {
    if (!fromCoreto(event)) return null;
    savePrefs({ closeToTray: Boolean(enabled) });
    return prefs.closeToTray;
  });
}

// ── Som da janela ou da tela compartilhada (Windows) ─────────────────────────
//
// O Chromium só captura o som do sistema inteiro, e isso inclui a própria chamada do Coreto (quem
// assiste ouviria a conversa de volta). O Discord captura o som só do programa escolhido; aqui
// quem faz isso é native/coreto-audio.exe (WASAPI por processo). Ele escreve PCM de 16 bits,
// estéreo, 48 kHz, que o site converte em uma faixa de áudio (client/src/lib/app-audio.ts).

const AUDIO_HELPER = app.isPackaged
  ? join(process.resourcesPath, 'coreto-audio.exe')
  : join(here, '..', 'native', 'bin', 'coreto-audio.exe');
const appAudioAvailable = () => process.platform === 'win32' && existsSync(AUDIO_HELPER);
/** Um byte de PCM = 1/192000 s; chunks de ~10 ms. */
const FRAME_BYTES = 4;

/** @type {{ id: number; child: import('node:child_process').ChildProcess } | null} */
let appAudio = null;
let appAudioCounter = 0;
/** Nome da tela ou janela escolhida por último no seletor, para a lista da sala mostrar o que está sendo compartilhado. */
let captureName = '';

/** @param {number} id */
function stopAppAudio(id = appAudio?.id ?? 0) {
  if (!appAudio || appAudio.id !== id) return;
  const { child } = appAudio;
  appAudio = null;
  // Fechar a entrada é o aviso combinado para o helper parar; o kill é só garantia.
  child.stdin?.destroy();
  setTimeout(() => child.kill(), 1000).unref();
}

/**
 * Começa a mandar o som da fonte escolhida para a janela do Coreto.
 * @param {string} sourceId id do desktopCapturer: "screen:..." ou "window:<HWND>:0"
 * @returns {boolean} se o helper subiu
 */
function startAppAudio(sourceId) {
  if (!mainWindow || !appAudioAvailable()) return false;
  stopAppAudio();
  const hwnd = /^window:(\d+):/.exec(sourceId)?.[1];
  // Janela: só o som do programa dela. Tela inteira: tudo, menos o próprio Coreto (a chamada).
  const args = hwnd ? ['window', hwnd] : sourceId.startsWith('screen:') ? ['exclude', String(process.pid)] : null;
  if (!args) return false;

  const id = ++appAudioCounter;
  const child = spawn(AUDIO_HELPER, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  appAudio = { id, child };
  const target = mainWindow.webContents;
  /** @type {Buffer} */
  let rest = Buffer.alloc(0);
  child.stdout?.on('data', (/** @type {Buffer} */ chunk) => {
    const data = rest.length ? Buffer.concat([rest, chunk]) : chunk;
    const whole = data.length - (data.length % FRAME_BYTES);
    rest = data.subarray(whole);
    if (whole > 0 && !target.isDestroyed()) target.send('desktop:app-audio', id, new Uint8Array(data.subarray(0, whole)));
  });
  child.stderr?.on('data', (/** @type {Buffer} */ line) => console.warn(`coreto-audio: ${line.toString().trim()}`));
  const ended = () => {
    if (appAudio?.id === id) appAudio = null;
    if (!target.isDestroyed()) target.send('desktop:app-audio-end', id);
  };
  child.on('error', ended);
  child.on('exit', ended);
  return true;
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
    captureName = source.name;
    if (!request.audioRequested) {
      stopAppAudio();
      return callback({ video: source });
    }
    // Com som: o helper pega só o da janela (ou o da tela sem a chamada) e o site o junta ao vídeo.
    if (startAppAudio(id)) return callback({ video: source });
    // Sem o helper: o som do sistema inteiro ("loopback"), só no Windows e só para a tela inteira.
    const loopback = process.platform === 'win32' && id.startsWith('screen:');
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
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    stopKeyWatcher();
    stopAppAudio();
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

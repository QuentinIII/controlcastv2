'use strict';

/*
 * ControlCast - main process
 */

const { app, BrowserWindow, ipcMain, Menu, Tray, dialog, shell, powerMonitor, screen } = require('electron');
const fs = require('fs');
const path = require('path');

const pkg = require('../package.json');
const { createLogger } = require('./main/logger');
const { ConfigStore } = require('./lib/config-store');
const { appDefaults, migrate, CONFIG_VERSION } = require('./lib/key-defaults');
const { Hotkeys } = require('./main/hotkeys');
const { ClrServer } = require('./main/clr-server');

// Keep the historical settings location: %APPDATA%\ControlCast
const userData = path.join(app.getPath('appData'), 'ControlCast');
app.setPath('userData', userData);

const logger = createLogger(path.join(userData, 'logs'));
logger.info(`ControlCast ${pkg.version} starting (Electron ${process.versions.electron}, ${process.platform} ${process.arch})`);

process.on('uncaughtException', err => logger.error('Uncaught exception (main):', err));
process.on('unhandledRejection', err => logger.error('Unhandled rejection (main):', err));


// Single instance


if (!app.requestSingleInstanceLock()) {
  app.quit();
  return; // eslint-disable-line no-unreachable
}


// Configuration (crash-safe)


const store = new ConfigStore({
  dir: userData,
  defaults: appDefaults(),
  logger,
  validate: data => data !== null && typeof data === 'object' && !Array.isArray(data),
});
logger.info(`Configuration loaded from ${store.file}: ${Object.keys(store.get('keys') || {}).length} keys` +
  (store.recovery ? ` (RECOVERED from ${store.recovery.from}: ${store.recovery.reason})` : ''));
if (store.get('app.version') !== CONFIG_VERSION) {
  logger.info(`Migrating configuration from v${store.get('app.version')} to v${CONFIG_VERSION}`);
  store.snapshot(true);
  store.replace(migrate(store.getAll()));
  store.flushSync();
}

if (store.get('app.disable_gpu')) {
  logger.info('Hardware acceleration disabled by user setting');
  app.disableHardwareAcceleration();
}

app.setAppUserModelId(pkg.build && pkg.build.appId ? pkg.build.appId : 'com.controlcast.app');


// Native helpers


let robot = null;
try {
  robot = require('@jitsi/robotjs');
} catch (err) {
  logger.error('Keyboard simulation unavailable (robotjs failed to load):', err);
}
const hotkeys = new Hotkeys({ robot, logger });

const clr = new ClrServer({
  assetsDir: path.join(__dirname, 'clr/assets'),
  indexFile: path.join(__dirname, 'clr/index.html'),
  imagesDir: path.join(userData, 'clr-images'),
  getKeys: () => store.get('keys'),
  logger,
});
migrateOldClrImages();


// State


let mainWindow = null;
let portWindow = null;
let tray = null;
let quitting = false;
let shutdownDone = false;
let pendingEdits = false; // Unsaved key edits in the window
let askingUnsaved = false;
const crashTimes = [];
const startHidden = process.argv.includes('--hidden');


// Helpers


function send(channel, ...args) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args);
}

function toast(type, text, timeout) {
  send('app:toast', { type, text, timeout });
}

function showMainWindow() {
  if (!mainWindow) {
    createMainWindow();
    return;
  }
  mainWindow.setSkipTaskbar(false);
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function visiblePosition(x, y, width, height) {
  if (typeof x !== 'number' || typeof y !== 'number') return {};
  // Ignore saved positions that are now off-screen (monitor unplugged, resolution changed)
  const visible = screen.getAllDisplays().some(d => {
    const a = d.workArea;
    return x + 100 > a.x && y + 50 > a.y && x + 100 < a.x + a.width && y + 50 < a.y + a.height;
  });
  return visible ? { x, y } : {};
}

async function applyClr() {
  const enabled = store.get('app.clr.enabled');
  const port = parseInt(store.get('app.clr.port'), 10) || 3000;
  if (!enabled) {
    await clr.stop();
    return;
  }
  if (clr.running && clr.port === port) return;
  await clr.stop();
  try {
    await clr.start(port);
  } catch (err) {
    toast('error', `CLR Browser: port ${port} is unavailable (${err.code || err.message}). ` +
      'Change it in Settings > CLR Browser > Change Port.', 8000);
  }
}

function migrateOldClrImages() {
  // Older versions stored CLR images inside the Squirrel install folder
  try {
    if (fs.readdirSync(clr.imagesDir).length) return;
    const base = path.join(process.env.LOCALAPPDATA || '', 'ControlCast');
    if (!process.env.LOCALAPPDATA || !fs.existsSync(base)) return;
    const versions = fs.readdirSync(base).filter(d => /^app-/.test(d)).sort().reverse();
    for (const v of versions) {
      const dir = path.join(base, v, 'resources/app/clr/assets/images');
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) fs.copyFileSync(path.join(dir, f), path.join(clr.imagesDir, f));
      logger.info(`Migrated CLR images from ${dir}`);
      return;
    }
  } catch (err) {
    logger.warn('CLR image migration skipped:', err.message);
  }
}


// Main window


function createMainWindow() {
  const pos = visiblePosition(store.get('app.pos.x'), store.get('app.pos.y'));
  mainWindow = new BrowserWindow(Object.assign({
    width: 900,
    height: 780,
    useContentSize: true,
    resizable: false,
    maximizable: false,
    icon: path.join(__dirname, process.platform === 'win32' ? 'images/icon.ico' : 'images/icon.png'),
    title: `ControlCast - ${pkg.version}`,
    backgroundColor: '#0B0B0C',
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
      backgroundThrottling: false, // Lights / audio must keep working when minimized or in the tray
      spellcheck: false,
    },
  }, pos));

  const win = mainWindow;

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) e.preventDefault();
  });
  win.webContents.on('did-start-loading', () => {
    hotkeys.releaseAll();
    pendingEdits = false;
  });

  win.on('moved', () => {
    const [x, y] = win.getPosition();
    store.set('app.pos', { x, y });
  });

  win.on('close', e => {
    if (store.get('app.close_to_tray') && !quitting) {
      e.preventDefault();
      win.hide();
      win.setSkipTaskbar(true);
      return;
    }
    const crashed = win.webContents.isCrashed && win.webContents.isCrashed();
    if (!shutdownDone && !crashed && pendingEdits) {
      // Unsaved key edits: never lose them silently
      e.preventDefault();
      if (askingUnsaved) return;
      askingUnsaved = true;
      askUnsavedEdits(win).then(choice => {
        askingUnsaved = false;
        if (choice === 'cancel') {
          quitting = false;
          return;
        }
        pendingEdits = false;
        quitting = true;
        if (!win.isDestroyed()) win.close();
      });
      return;
    }
    if (!shutdownDone && !crashed) {
      // Let the renderer turn the Launchpad lights off and close the MIDI ports
      e.preventDefault();
      quitting = true;
      const finish = () => {
        if (shutdownDone) return;
        shutdownDone = true;
        if (!win.isDestroyed()) win.close();
      };
      ipcMain.once('app:shutdown-done', finish);
      setTimeout(finish, 1000);
      send('app:shutdown');
    }
  });

  win.on('closed', () => {
    mainWindow = null;
  });

  // Windows is logging off / shutting down: make sure everything is on disk
  win.on('query-session-end', () => {
    quitting = true; // Never block Windows shutdown with "close to tray"
    if (pendingEdits) {
      pendingEdits = false;
      send('edit:save'); // No time to ask: keep the edits
    }
    store.flushSync();
  });
  win.on('session-end', () => {
    logger.info('Windows session ending, flushing configuration');
    quitting = true;
    store.flushSync();
  });

  win.on('unresponsive', () => logger.warn('Main window is not responding'));
  win.on('responsive', () => logger.info('Main window is responding again'));

  win.webContents.on('render-process-gone', (e, details) => {
    logger.error(`Renderer process gone: ${details.reason} (exit code ${details.exitCode})`);
    hotkeys.releaseAll();
    if (quitting || details.reason === 'clean-exit') return;
    const now = Date.now();
    crashTimes.push(now);
    while (crashTimes.length && now - crashTimes[0] > 60000) crashTimes.shift();
    if (crashTimes.length > 3) {
      dialog.showErrorBox('ControlCast', 'The window crashed several times in a row. ' +
        `See the log file in ${logger.dir}`);
      return;
    }
    setTimeout(() => {
      if (!win.isDestroyed()) win.reload();
    }, 1000);
  });

  win.loadFile(path.join(__dirname, 'index.html'));

  win.once('ready-to-show', () => {
    if (store.get('app.start_minimized') || startHidden) {
      if (store.get('app.close_to_tray')) {
        win.setSkipTaskbar(true); // Stay in the tray
      } else {
        win.showInactive();
        win.minimize();
      }
    } else {
      win.show();
    }
  });
}


// Ask what to do with unsaved key edits. Resolves 'save' | 'discard' | 'cancel'
async function askUnsavedEdits(win) {
  if (!win.isVisible() || win.isMinimized()) showMainWindow();
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Save', "Don't save", 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
    title: 'ControlCast',
    message: 'Some key settings have not been saved.',
    detail: 'Save them before closing ControlCast?',
  });
  if (response === 2) return 'cancel';
  if (response === 1) {
    logger.info('Closing: unsaved key edits discarded by user');
    return 'discard';
  }
  const saved = await new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), 3000);
    ipcMain.once('edit:saved', (e, ok) => {
      clearTimeout(timer);
      resolve(ok);
    });
    send('edit:save');
  });
  logger.info(`Closing: unsaved key edits ${saved ? 'saved' : 'COULD NOT BE SAVED'}`);
  if (!saved) {
    const r = await dialog.showMessageBox(win, {
      type: 'error',
      buttons: ['Close anyway', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      message: 'The settings could not be saved.',
      detail: `See the log file in ${logger.dir}`,
    });
    return r.response === 0 ? 'discard' : 'cancel';
  }
  return 'save';
}


// Port window


function createPortWindow() {
  if (portWindow) {
    portWindow.focus();
    return;
  }
  const opts = {
    width: 320,
    height: 180,
    useContentSize: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    icon: path.join(__dirname, process.platform === 'win32' ? 'images/icon.ico' : 'images/icon.png'),
    title: 'CLR Port',
    webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false },
  };
  if (mainWindow) opts.parent = mainWindow;
  portWindow = new BrowserWindow(opts);
  portWindow.setMenu(null);
  portWindow.on('closed', () => {
    portWindow = null;
  });
  portWindow.loadFile(path.join(__dirname, 'port.html'));
}


// Menus


function setAutoStart(enabled) {
  store.set('app.auto_start', enabled);
  try {
    app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] });
  } catch (err) {
    logger.error('Unable to change login item:', err);
  }
}

function backupsDir() {
  return store.backupDir;
}

async function exportConfig() {
  const res = await dialog.showSaveDialog(mainWindow, {
    title: 'Export ControlCast configuration',
    defaultPath: path.join(app.getPath('documents'), `ControlCast-config-${new Date().toISOString().slice(0, 10)}.json`),
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (res.canceled || !res.filePath) return;
  try {
    store.exportTo(res.filePath);
    toast('success', 'Configuration exported');
  } catch (err) {
    toast('error', `Export failed: ${err.message}`, 5000);
  }
}

async function importConfig(defaultPath) {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Import ControlCast configuration',
    defaultPath: defaultPath || app.getPath('documents'),
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (res.canceled || !res.filePaths.length) return;
  const answer = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['Replace', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Import configuration',
    message: 'Replace the current configuration with this file?',
    detail: 'The current configuration is saved in the backups folder first.',
  });
  if (answer.response !== 0) return;
  try {
    store.importFrom(res.filePaths[0]);
    const migrated = migrate(store.getAll());
    store.replace(migrated);
    store.flushSync();
    buildMenus();
    applyClr();
    toast('success', 'Configuration imported');
  } catch (err) {
    toast('error', `Import failed: ${err.message}`, 5000);
  }
}

async function resetConfig() {
  const answer = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['Erase everything', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    title: 'Reset configuration',
    message: 'Erase the whole ControlCast configuration?',
    detail: 'Every key (colours, lights, hotkeys, sounds, web requests, CLR) and every setting ' +
      'will be reset to default.\n\nA copy of the current configuration is saved first: ' +
      'it can be brought back with File > Restore an automatic backup.',
  });
  if (answer.response !== 0) return;
  try {
    const backup = store.snapshot(true);
    logger.info(`Configuration reset by user (backup: ${backup})`);
    const pos = store.get('app.pos');
    const fresh = appDefaults();
    fresh.app.pos = pos; // Keep the window where it is
    store.replace(fresh); // Notifies the window (config:reset)
    store.flushSync();
    try {
      app.setLoginItemSettings({ openAtLogin: false, args: ['--hidden'] });
    } catch (err) {
      logger.warn('Login item reset failed:', err.message);
    }
    buildMenus();
    applyClr();
    toast('success', 'Configuration erased', 2000);
  } catch (err) {
    logger.error('Configuration reset failed:', err);
    toast('error', `Reset failed: ${err.message}`, 5000);
  }
}

function buildMenus() {
  const clrEnabled = !!store.get('app.clr.enabled');
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'Export configuration...', click: exportConfig },
        { label: 'Import configuration...', click: () => importConfig() },
        { label: 'Restore an automatic backup...', click: () => importConfig(backupsDir()) },
        { label: 'Reset configuration...', click: resetConfig },
        { label: 'Open settings folder', click: () => shell.openPath(userData) },
        { type: 'separator' },
        {
          label: 'Exit',
          click: () => {
            quitting = true;
            app.quit();
          },
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => mainWindow && mainWindow.reload() },
        { label: 'Toggle Dev Tools', accelerator: 'Ctrl+Shift+I', click: () => mainWindow && mainWindow.webContents.toggleDevTools() },
      ],
    },
    {
      label: 'Settings',
      submenu: [
        {
          label: 'Close to Tray',
          type: 'checkbox',
          checked: !!store.get('app.close_to_tray'),
          click: item => store.set('app.close_to_tray', item.checked),
        },
        {
          label: 'Start with Windows',
          type: 'checkbox',
          checked: !!store.get('app.auto_start'),
          click: item => setAutoStart(item.checked),
        },
        {
          label: 'Start Minimized',
          type: 'checkbox',
          checked: !!store.get('app.start_minimized'),
          click: item => store.set('app.start_minimized', item.checked),
        },
        {
          label: 'Disable hardware acceleration (restart required)',
          type: 'checkbox',
          checked: !!store.get('app.disable_gpu'),
          click: item => {
            store.set('app.disable_gpu', item.checked);
            store.flushSync();
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              message: 'Restart ControlCast to apply this setting.',
              detail: 'Try this if the window flickers, stays black or freezes with your graphics driver.',
            });
          },
        },
        {
          label: 'CLR Browser',
          submenu: [
            {
              label: 'Enabled',
              type: 'checkbox',
              checked: clrEnabled,
              click: item => {
                store.set('app.clr.enabled', item.checked);
                buildMenus();
                applyClr().then(() => {
                  if (item.checked && clr.running) send('clr:show-address');
                });
              },
            },
            { label: 'Change Port', enabled: clrEnabled, click: createPortWindow },
            {
              label: 'Open Browser',
              enabled: clrEnabled,
              click: () => shell.openExternal(`http://localhost:${store.get('app.clr.port') || 3000}`),
            },
          ],
        },
      ],
    },
    {
      label: 'Launchpad',
      submenu: [
        { label: 'Reconnect', click: () => send('launchpad:reconnect') },
        { label: 'Stop all audio', click: () => send('audio:stop-all') },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'View on GitHub', click: () => shell.openExternal(pkg.homepage) },
        { label: 'Open logs folder', click: () => shell.openPath(logger.dir) },
        {
          label: 'About',
          click: () => dialog.showMessageBox(mainWindow, {
            type: 'info',
            buttons: ['OK'],
            title: 'About ControlCast',
            message: `ControlCast ${pkg.version}`,
            detail: `Originally by DBKynd - Artwork and Beta Testing by AnneMunition\n\n` +
              `Electron ${process.versions.electron}\nSettings: ${userData}`,
          }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createTray() {
  const icon = process.platform === 'win32' ? 'images/icon.ico' : 'images/icon.png';
  try {
    tray = new Tray(path.join(__dirname, icon));
  } catch (err) {
    logger.error('Unable to create the tray icon:', err);
    return;
  }
  tray.setToolTip('ControlCast');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Restore', click: showMainWindow },
    {
      label: 'Reset Position',
      click: () => {
        showMainWindow();
        if (mainWindow) mainWindow.center();
      },
    },
    { type: 'separator' },
    {
      label: 'Exit',
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]));
  tray.on('double-click', () => {
    if (mainWindow && mainWindow.isVisible() && !mainWindow.isMinimized()) {
      if (store.get('app.close_to_tray')) {
        mainWindow.hide();
        mainWindow.setSkipTaskbar(true);
      } else {
        mainWindow.minimize();
      }
    } else {
      showMainWindow();
    }
  });
}


// IPC


let currentSender = null;
store.on('change', (p, value) => {
  for (const w of BrowserWindow.getAllWindows()) {
    if (w.isDestroyed() || w.webContents === currentSender) continue;
    if (p === null || typeof p !== 'string') w.webContents.send('config:reset', store.getAll());
    else w.webContents.send('config:changed', p, value);
  }
});

ipcMain.on('config:get-all', e => {
  e.returnValue = store.getAll();
});

ipcMain.on('config:set', (e, p, value) => {
  currentSender = e.sender;
  try {
    store.set(p, value);
  } finally {
    currentSender = null;
  }
  if (typeof p === 'string' && p.startsWith('app.')) buildMenus();
});

ipcMain.on('config:flush', e => {
  const ok = store.flushSync();
  logger.info(`Configuration saved to ${store.file} (${Object.keys(store.get('keys') || {}).length} keys)${ok ? '' : ' - FAILED'}`);
  e.returnValue = ok;
});

ipcMain.on('edit:pending', (e, pending) => {
  pendingEdits = !!pending;
});

ipcMain.on('app:startup-info', e => {
  e.returnValue = {
    version: pkg.version,
    recovery: store.recovery,
    hotkeys: hotkeys.available,
    userData,
  };
});

ipcMain.on('log', (e, level, ...args) => {
  (logger[level] || logger.info)('[renderer]', ...args);
});

ipcMain.on('hotkey:send', (e, combo) => hotkeys.send(combo));
ipcMain.on('hotkey:down', (e, combo) => hotkeys.down(combo));
ipcMain.on('hotkey:up', (e, combo) => hotkeys.up(combo));
ipcMain.on('hotkey:release-all', () => hotkeys.releaseAll());

ipcMain.on('clr:key-press', (e, data) => clr.emit('key_press', data));
ipcMain.on('clr:flush', () => clr.emit('flush'));
ipcMain.handle('clr:set-image', (e, key, source) => clr.setImage(key, source));
ipcMain.handle('clr:status', () => ({ running: clr.running, port: clr.port }));

ipcMain.handle('dialog:open-file', async (e, opts) => {
  const res = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender) || mainWindow,
    Object.assign({ properties: ['openFile'] }, opts));
  return res.canceled ? null : res.filePaths[0] || null;
});

ipcMain.on('change_port', createPortWindow);
ipcMain.on('port:close', () => portWindow && portWindow.close());
ipcMain.on('set_port', (e, port) => {
  port = parseInt(port, 10);
  if (!(port > 0 && port < 65536)) return;
  if (store.get('app.clr.port') === port) return;
  store.set('app.clr.port', port);
  applyClr().then(() => {
    if (clr.running) send('clr:show-address');
  });
});


// App lifecycle


app.on('second-instance', showMainWindow);

app.whenReady().then(() => {
  // Keep the Windows login item in sync with the setting
  try {
    const login = app.getLoginItemSettings({ args: ['--hidden'] });
    if (login.openAtLogin !== !!store.get('app.auto_start')) {
      app.setLoginItemSettings({ openAtLogin: !!store.get('app.auto_start'), args: ['--hidden'] });
    }
  } catch (err) {
    logger.warn('Login item check failed:', err.message);
  }

  for (const step of [buildMenus, createTray, createMainWindow]) {
    try {
      step();
    } catch (err) {
      logger.error(`Startup step ${step.name} failed:`, err);
    }
  }
  applyClr();

  powerMonitor.on('suspend', () => {
    logger.info('System suspending, flushing configuration');
    store.flushSync();
    hotkeys.releaseAll();
  });
  powerMonitor.on('resume', () => {
    logger.info('System resumed');
    send('system:resume');
  });
  powerMonitor.on('shutdown', () => store.flushSync());
});

app.on('child-process-gone', (e, details) => {
  logger.error(`Child process gone: ${details.type} ${details.reason}`);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  quitting = true;
});

app.on('will-quit', () => {
  hotkeys.releaseAll();
  store.flushSync();
  logger.info(`Configuration written on exit (${Object.keys(store.get('keys') || {}).length} keys)`);
  clr.stop();
  if (tray) tray.destroy();
  logger.info('ControlCast stopped');
});

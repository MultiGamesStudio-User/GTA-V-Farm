'use strict';

const { app, BrowserWindow, ipcMain, globalShortcut, dialog } = require('electron');
const path    = require('path');
const fs      = require('fs');
const https   = require('https');
const { spawn, execSync } = require('child_process');
const { checkForUpdates } = require('./updater');

// ── Config centralisée ────────────────────────────────────────────────────────
const APP_CONFIG = require('./app.config.json');

// ── Logger fichier ────────────────────────────────────────────────────────────
// Écrit dans <dossier du .bat>/app.log  (accessible même si la fenêtre ne s'ouvre pas)
const LOG_PATH = path.join(__dirname, '..', 'app.log');

function _ts() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function writeLog(level, ...args) {
  const line = `[${_ts()}] [${level}] ${args.join(' ')}\n`;
  try { fs.appendFileSync(LOG_PATH, line, 'utf-8'); } catch (_) {}
  if (level === 'ERROR' || level === 'WARN') console.error(line.trim());
  else console.log(line.trim());
}

// Vider le log au démarrage (garde les 500 dernières lignes si le fichier existe)
try {
  if (fs.existsSync(LOG_PATH)) {
    const lines = fs.readFileSync(LOG_PATH, 'utf-8').split('\n');
    if (lines.length > 600) {
      fs.writeFileSync(LOG_PATH, lines.slice(-500).join('\n') + '\n', 'utf-8');
    }
  }
  writeLog('INFO', `═══ ${APP_CONFIG.appName} démarrage ═══`);
} catch (_) {}

// Capture globale des exceptions non gérées
process.on('uncaughtException', (err) => {
  writeLog('FATAL', 'uncaughtException:', err.stack || err.message);
  try {
    dialog.showErrorBox('MacroEngine — Erreur fatale', err.stack || err.message);
  } catch (_) {}
});

process.on('unhandledRejection', (reason) => {
  writeLog('FATAL', 'unhandledRejection:', reason?.stack || String(reason));
});

// ── Chemins ───────────────────────────────────────────────────────────────────
const IS_PACKED   = app.isPackaged;
const BOT_DIR     = IS_PACKED
  ? path.join(process.resourcesPath, 'bot')
  : path.join(__dirname, '..');

const ROOT_DIR      = BOT_DIR;
const MAIN_PY       = path.join(BOT_DIR, 'main.py');
const MACROS_PATH   = path.join(BOT_DIR, 'macros.json');
const LICENSE_PATH  = path.join(BOT_DIR, 'license.json');
const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');

// ── Résolution du chemin Python ───────────────────────────────────────────────
function resolvePython() {
  // 0. Variable injectée par le .bat (chemin local portable)
  if (process.env.PYTHON_OVERRIDE && fs.existsSync(process.env.PYTHON_OVERRIDE)) {
    return process.env.PYTHON_OVERRIDE;
  }

  // 1. Bundled embedded Python (ships with the app) — on cherche d'abord à la racine
  const embedDirs = IS_PACKED
    ? [path.join(process.resourcesPath, 'python-embed')]
    : [
        path.join(__dirname, '..', 'python-embed'), // racine du projet (nouvelle loc)
        path.join(__dirname, 'python-embed'),        // ancien emplacement fallback
      ];
  for (const d of embedDirs) {
    const exe = path.join(d, 'python.exe');
    if (fs.existsSync(exe)) return exe;
  }

  // 2. where python (skip Windows Store stub)
  try {
    const out = execSync('where python', { windowsHide: true, timeout: 4000 }).toString();
    const real = out.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
                    .find(p => !p.toLowerCase().includes('windowsapps'));
    if (real) return real;
  } catch (_) {}
  // 3. py launcher
  try {
    const exe = execSync('py -3 -c "import sys;print(sys.executable)"', { windowsHide: true, timeout: 4000 })
                  .toString().trim();
    if (exe && fs.existsSync(exe)) return exe;
  } catch (_) {}
  // 4. Known install locations
  const dirs = ['Python311','Python312','Python313','Python310','Python39'];
  return [
    ...dirs.map(d => path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', d, 'python.exe')),
    ...dirs.map(d => path.join('C:\\', d, 'python.exe')),
  ].find(p => fs.existsSync(p)) || null;
}

let PYTHON_EXE = resolvePython();

writeLog('INFO', 'BOT_DIR    :', BOT_DIR);
writeLog('INFO', 'MAIN_PY    :', MAIN_PY, '| existe:', fs.existsSync(MAIN_PY));
writeLog('INFO', 'PYTHON_EXE :', PYTHON_EXE || 'INTROUVABLE');
writeLog('INFO', 'NODE       :', process.version, '| Electron:', process.versions.electron);

// ── Settings helpers ─────────────────────────────────────────────────────────
function readSettings() {
  try {
    if (!fs.existsSync(SETTINGS_PATH)) return {};
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
  } catch (_) { return {}; }
}

function saveSettings(data) {
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

// ── Global shortcuts state ───────────────────────────────────────────────────
let registeredShortcuts = {}; // { action: accelerator }

// ── License helpers ──────────────────────────────────────────────────────────
const LICENSE_GRACE_DAYS    = 7;
const LICENSE_TIMEOUT_MS    = 5000;

function readLicenseData() {
  try {
    if (!fs.existsSync(LICENSE_PATH)) return null;
    return JSON.parse(fs.readFileSync(LICENSE_PATH, 'utf-8'));
  } catch (_) { return null; }
}

function readLicense() {
  const d = readLicenseData();
  return d ? (d.key || null) : null;
}

function saveLicense(key) {
  fs.mkdirSync(path.dirname(LICENSE_PATH), { recursive: true });
  fs.writeFileSync(LICENSE_PATH, JSON.stringify({ key, validatedAt: Date.now() }), 'utf-8');
}

function verifyLicenseOnline(key) {
  return new Promise((resolve) => {
    const safeKey = encodeURIComponent(key);
    const url = `${APP_CONFIG.licenseApiBase}/${APP_CONFIG.licenseApiId}/${safeKey}/verify`;
    const req = https.get(url, { headers: { 'User-Agent': `${APP_CONFIG.appName}/${app.getVersion()}` } }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve({ valid: !!data.valid, offline: false });
        } catch (_) {
          resolve({ valid: false, offline: false });
        }
      });
    });
    req.setTimeout(LICENSE_TIMEOUT_MS, () => {
      req.destroy();
      resolve({ valid: false, offline: true });
    });
    req.on('error', () => {
      resolve({ valid: false, offline: true });
    });
  });
}

// ── Utilitaires ──────────────────────────────────────────────────────────────
function _debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ── État global ───────────────────────────────────────────────────────────────
let mainWindow    = null;
let overlayWindow = null;
let engineProc    = null;          // Python macro engine process
const _pending    = new Map();     // request id → { resolve, reject }
let _msgBuf       = '';            // line buffer for engine stdout

function _sendToOverlay(channel, data) {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    try { overlayWindow.webContents.send(channel, data); } catch (_) {}
  }
}

// ── Fenêtre principale ────────────────────────────────────────────────────────
function createWindow () {
  writeLog('INFO', 'createWindow() appelé');
  const saved   = readSettings();
  const bounds  = saved.windowBounds || {};

  mainWindow = new BrowserWindow({
    width:     bounds.width  || 1340,
    height:    bounds.height || 840,
    x:         bounds.x,
    y:         bounds.y,
    minWidth:  1000,
    minHeight: 640,
    backgroundColor: '#0d0d0d',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color:       '#0d0d0d',
      symbolColor: '#cccccc',
      height:      34,
    },
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          false,
    },
  });

  const htmlPath = path.join(__dirname, 'renderer', 'index.html');
  writeLog('INFO', 'loadFile:', htmlPath, '| existe:', fs.existsSync(htmlPath));
  mainWindow.loadFile(htmlPath);

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    writeLog('ERROR', 'did-fail-load:', code, desc, url);
  });

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    writeLog('ERROR', 'render-process-gone:', JSON.stringify(details));
  });

  mainWindow.on('unresponsive', () => {
    writeLog('WARN', 'Fenêtre non réactive (unresponsive)');
  });

  // Open DevTools in dev mode
  if (!IS_PACKED) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // Save window bounds on close/resize/move
  const saveBounds = _debounce(() => {
    if (!mainWindow || mainWindow.isMaximized() || mainWindow.isMinimized()) return;
    const b = mainWindow.getBounds();
    const s = readSettings();
    s.windowBounds = b;
    saveSettings(s);
  }, 500);

  mainWindow.on('resize', saveBounds);
  mainWindow.on('move',   saveBounds);
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── Mise à jour automatique ───────────────────────────────────────────────────
async function _runAutoUpdate() {
  writeLog('INFO', 'Updater: vérification des mises à jour…');
  mainWindow?.webContents.send('updater:checking');
  try {
    const result = await checkForUpdates(BOT_DIR, APP_CONFIG.github, (file) => {
      writeLog('INFO', 'Updater: ↓', file);
      mainWindow?.webContents.send('updater:progress', { file });
    });

    if (result.upToDate) {
      writeLog('INFO', `Updater: à jour (v${result.version})`);
      mainWindow?.webContents.send('updater:up-to-date', { version: result.version });
    } else {
      writeLog('INFO', `Updater: ${result.updated.length} fichier(s) mis à jour → v${result.version}`);
      if (result.errors.length) {
        for (const e of result.errors) writeLog('WARN', `Updater: erreur sur ${e.file} — ${e.error}`);
      }
      mainWindow?.webContents.send('updater:done', {
        version : result.version,
        updated : result.updated,
        errors  : result.errors,
      });
    }
  } catch (err) {
    writeLog('WARN', 'Updater: impossible de vérifier les mises à jour —', err.message);
    mainWindow?.webContents.send('updater:error', { error: err.message });
  }
}

ipcMain.handle('updater:check', () => {
  _runAutoUpdate();
  return { ok: true };
});

app.whenReady().then(() => {
  writeLog('INFO', 'app ready');
  createWindow();

  mainWindow.webContents.once('did-finish-load', async () => {
    writeLog('INFO', 'Renderer chargé (did-finish-load)');
    // ── Check Python is available ──────────────────────────────
    if (!PYTHON_EXE) {
      const msg = 'Python introuvable. Le Python embarqué est manquant et aucun Python système n\'a été trouvé.';
      writeLog('ERROR', msg);
      mainWindow?.webContents.send('setup:error', { msg });
      return;
    }
    writeLog('INFO', 'Python OK →', PYTHON_EXE);
    mainWindow?.webContents.send('setup:done');

    // ── Vérification automatique des mises à jour ──────────────
    _runAutoUpdate();
  });
}).catch(err => {
  writeLog('FATAL', 'app.whenReady() rejeté:', err.stack || err.message);
});

app.on('window-all-closed', () => {
  killEngine();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ── Macro Engine : démarrage / arrêt ─────────────────────────────────────────
function startEngine() {
  if (engineProc) return;

  writeLog('INFO', 'startEngine() →', PYTHON_EXE, MAIN_PY);
  engineProc = spawn(PYTHON_EXE, ['-u', MAIN_PY], {
    cwd:         ROOT_DIR,
    windowsHide: true,
    env:         { ...process.env, PYTHONUNBUFFERED: '1' },
  });

  // Line-by-line stdout reader
  engineProc.stdout.on('data', chunk => {
    _msgBuf += chunk.toString();
    const lines = _msgBuf.split('\n');
    _msgBuf = lines.pop();          // keep incomplete last line
    for (const line of lines) {
      if (!line.trim()) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      _dispatchFromEngine(msg);
    }
  });

  engineProc.stderr.on('data', d => {
    const txt = d.toString().trim();
    writeLog('PYERR', txt);
    mainWindow?.webContents.send('engine:log', { level: 'ERROR', msg: txt });
    _sendToOverlay('overlay:log', { level: 'PYERR', msg: txt });
  });

  engineProc.on('close', code => {
    writeLog('INFO', 'Engine fermé, code:', code);
    engineProc = null;
    _msgBuf    = '';
    for (const [, { reject }] of _pending) reject(new Error('Engine stopped'));
    _pending.clear();
    mainWindow?.webContents.send('engine:stopped', { code });
    _sendToOverlay('overlay:stopped');
  });

  engineProc.on('error', err => {
    writeLog('ERROR', 'Engine spawn error:', err.message);
    engineProc = null;
    mainWindow?.webContents.send('engine:stopped', { error: err.message });
  });
}

function killEngine() {
  if (!engineProc) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/F', '/T', '/PID', String(engineProc.pid)], { windowsHide: true });
    } else {
      engineProc.kill('SIGTERM');
    }
  } catch (_) {}
  engineProc = null;
}

// ── Engine message router ─────────────────────────────────────────────────────
function _dispatchFromEngine(msg) {
  if (msg.type === 'response') {
    const p = _pending.get(msg.id);
    if (p) {
      _pending.delete(msg.id);
      p.resolve(msg);
    }
  } else if (msg.type === 'log') {
    mainWindow?.webContents.send('engine:log', { level: msg.level, msg: msg.msg });
    _sendToOverlay('overlay:log', { level: msg.level, msg: msg.msg });
  } else if (msg.type === 'status') {
    mainWindow?.webContents.send('engine:status', { running: msg.running });
  } else if (msg.type === 'status_update') {
    mainWindow?.webContents.send('engine:status_update', msg);
    _sendToOverlay('overlay:status', msg);
  } else if (msg.type === 'record_event') {
    mainWindow?.webContents.send('engine:record_event', msg.action);
  } else if (msg.type === 'webhook_error') {
    mainWindow?.webContents.send('engine:webhook_error', { msg: msg.msg });
  } else if (msg.type === 'macro_start_request') {
    mainWindow?.webContents.send('engine:macro_start_request', { name: msg.name });
  }
}

// ── Send command to engine and await response ─────────────────────────────────
function engineCmd(cmd) {
  return new Promise((resolve, reject) => {
    if (!engineProc) { reject(new Error('Engine not running')); return; }
    const id = `${cmd.cmd}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    // Store timer handle so it can be cancelled when response arrives
    const timer = setTimeout(() => {
      if (_pending.has(id)) {
        _pending.delete(id);
        reject(new Error('Engine timeout'));
      }
    }, 15000);
    _pending.set(id, {
      resolve: (v) => { clearTimeout(timer); resolve(v); },
      reject:  (e) => { clearTimeout(timer); reject(e); },
    });
    try {
      engineProc.stdin.write(JSON.stringify({ ...cmd, id }) + '\n');
    } catch (e) {
      clearTimeout(timer);
      _pending.delete(id);
      reject(e);
    }
  });
}

// ── IPC: engine lifecycle ─────────────────────────────────────────────────────
ipcMain.handle('engine:start', () => {
  startEngine();
  return { ok: true };
});

ipcMain.handle('engine:stop', () => {
  killEngine();
  return { ok: true };
});

ipcMain.handle('engine:status', async () => {
  if (!engineProc) return { ok: true, engineRunning: false, running: [] };
  try {
    const r = await engineCmd({ cmd: 'status' });
    return { ok: true, engineRunning: true, running: r.running || [] };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ── IPC: forwarded engine commands ───────────────────────────────────────────
for (const cmd of [
  // Windows & display
  'list_windows', 'get_window_rect', 'get_window_info', 'is_window_focused',
  'focus_window', 'get_screen_info', 'find_window_monitor',
  // Coords
  'validate_point', 'validate_region', 'scale_coords',
  // Vision & OCR
  'preview_region', 'pick_color', 'check_ocr', 'ocr_text',
  // Macros
  'macro_start', 'macro_stop', 'macro_pause', 'macro_resume', 'stop_all',
  // Conditions / Actions testing
  'test_condition', 'exec_action',
  // Recording
  'record_start', 'record_stop',
  // Webhook
  'set_webhook', 'send_webhook',
  // State / Stats
  'get_stats', 'get_variables', 'set_variable', 'set_counter', 'clear_state',
  // Dead zones
  'set_dead_zones', 'get_dead_zones',
  // Pixel snapshot
  'pixel_snapshot',
]) {
  ipcMain.handle(`engine:${cmd}`, async (_evt, params) => {
    if (!engineProc) {
      // auto-start engine on first use
      startEngine();
      await new Promise(r => setTimeout(r, 800));
    }
    try {
      return await engineCmd({ cmd, ...params });
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
}

// ── IPC: Screen picker overlay ───────────────────────────────────────────────
let pickerWindow = null;

ipcMain.handle('picker:start', (_evt, opts) => {
  return new Promise((resolve) => {
    if (pickerWindow) {
      pickerWindow.close();
      pickerWindow = null;
    }

    const { screen } = require('electron');
    const displays = screen.getAllDisplays();
    // Get the bounds covering all displays
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const d of displays) {
      minX = Math.min(minX, d.bounds.x);
      minY = Math.min(minY, d.bounds.y);
      maxX = Math.max(maxX, d.bounds.x + d.bounds.width);
      maxY = Math.max(maxY, d.bounds.y + d.bounds.height);
    }

    pickerWindow = new BrowserWindow({
      x: minX, y: minY,
      width: maxX - minX, height: maxY - minY,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      focusable: true,
      webPreferences: {
        preload: path.join(__dirname, 'picker-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    pickerWindow.loadFile(path.join(__dirname, 'renderer', 'picker.html'));
    pickerWindow.once('ready-to-show', () => {
      pickerWindow.webContents.send('picker:init', {
        mode: opts?.mode || 'point', // 'point' or 'region'
        offsetX: minX,
        offsetY: minY,
      });
    });

    // Listen for result
    ipcMain.once('picker:result', (_e, result) => {
      if (pickerWindow) {
        pickerWindow.close();
        pickerWindow = null;
      }
      resolve(result);
    });

    pickerWindow.on('closed', () => {
      pickerWindow = null;
      // If no result sent yet, resolve with null
      ipcMain.removeAllListeners('picker:result');
      resolve(null);
    });
  });
});

// ── Overlay window ────────────────────────────────────────────────────────────
function createOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    if (!overlayWindow.isVisible()) overlayWindow.showInactive();
    return;
  }

  const s   = readSettings();
  const pos = s.overlayBounds || { x: 24, y: 80 };

  const savedSize = s.overlaySize || {};
  overlayWindow = new BrowserWindow({
    x:           pos.x,
    y:           pos.y,
    width:       300,
    height:      savedSize.height || 360,
    minWidth:    260,
    minHeight:   200,
    maxWidth:    400,
    frame:       false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable:   true,
    focusable:   true,
    show:        false,
    webPreferences: {
      preload:          path.join(__dirname, 'overlay-preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  });

  overlayWindow.loadFile(path.join(__dirname, 'renderer', 'overlay.html'));

  overlayWindow.once('ready-to-show', () => {
    overlayWindow.showInactive();          // show WITHOUT stealing focus
    overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  });

  // Persist position
  const _saveOverlayPos = _debounce(() => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    const [x, y] = overlayWindow.getPosition();
    const s = readSettings();
    s.overlayBounds = { x, y };
    saveSettings(s);
  }, 500);

  const _saveOverlaySize = _debounce(() => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    const [width, height] = overlayWindow.getSize();
    const s = readSettings();
    s.overlaySize = { width, height };
    saveSettings(s);
  }, 500);

  overlayWindow.on('move',   _saveOverlayPos);
  overlayWindow.on('resize', _saveOverlaySize);

  overlayWindow.on('closed', () => {
    overlayWindow = null;
    mainWindow?.webContents.send('overlay:closed');
  });
}

ipcMain.handle('overlay:show', () => {
  createOverlayWindow();
  return { ok: true, visible: true };
});

ipcMain.handle('overlay:hide', () => {
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide();
  return { ok: true, visible: false };
});

ipcMain.handle('overlay:toggle', () => {
  if (overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible()) {
    overlayWindow.hide();
    return { ok: true, visible: false };
  }
  createOverlayWindow();
  return { ok: true, visible: true };
});

ipcMain.on('overlay:stop-all', async () => {
  try { await engineCmd({ cmd: 'stop_all' }); } catch (_) {}
  mainWindow?.webContents.send('shortcut:triggered', { action: 'stop' });
});

ipcMain.on('overlay:close', () => {
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.close();
});

ipcMain.on('overlay:minimize', () => {
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide();
  mainWindow?.webContents.send('overlay:closed');
});

ipcMain.on('overlay:macro-start', async (_, { name }) => {
  try { await engineCmd({ cmd: 'macro_start', name }); } catch (_) {}
});

ipcMain.on('overlay:macro-stop', async (_, { name }) => {
  try { await engineCmd({ cmd: 'macro_stop', name }); } catch (_) {}
});

ipcMain.handle('overlay:get-macros', () => {
  try {
    if (!fs.existsSync(MACROS_PATH)) return { macros: [] };
    const data = JSON.parse(fs.readFileSync(MACROS_PATH, 'utf-8'));
    return { macros: Array.isArray(data) ? data.map(m => m.name) : [] };
  } catch (_) { return { macros: [] }; }
});

ipcMain.on('overlay:focus-main', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  }
});

// ── IPC: macros file (save/load JSON) ────────────────────────────────────────
ipcMain.handle('macros:read', () => {
  try {
    if (!fs.existsSync(MACROS_PATH)) return { ok: true, macros: [] };
    const data = JSON.parse(fs.readFileSync(MACROS_PATH, 'utf-8'));
    return { ok: true, macros: Array.isArray(data) ? data : [] };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('macros:write', (_evt, macros) => {
  try {
    fs.mkdirSync(path.dirname(MACROS_PATH), { recursive: true });
    fs.writeFileSync(MACROS_PATH, JSON.stringify(macros, null, 2), 'utf-8');
    _sendToOverlay('overlay:macros-updated', {});
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ── IPC: app config ───────────────────────────────────────────────────────────
ipcMain.handle('app:getConfig', () => ({
  ...APP_CONFIG,
  version: app.getVersion(),
}));

// ── IPC: license ─────────────────────────────────────────────────────────────
ipcMain.handle('license:check', async () => {
  const licData = readLicenseData();
  if (!licData || !licData.key) return { valid: false, reason: 'missing' };

  const result = await verifyLicenseOnline(licData.key);
  if (result.valid) {
    saveLicense(licData.key);        // Rafraîchir validatedAt
    return { valid: true };
  }

  // Réseau injoignable → grace period
  if (result.offline && licData.validatedAt) {
    const daysSince = (Date.now() - licData.validatedAt) / 86400000;
    if (daysSince <= LICENSE_GRACE_DAYS) {
      const daysLeft = Math.ceil(LICENSE_GRACE_DAYS - daysSince);
      writeLog('WARN', `Licence: mode hors-ligne, ${daysLeft}j restants`);
      return { valid: true, offline: true, daysLeft };
    }
    return { valid: false, reason: 'grace_expired' };
  }

  return { valid: false, reason: result.offline ? 'network' : 'invalid' };
});

ipcMain.handle('license:verify', async (_evt, key) => {
  if (!key || typeof key !== 'string' || !key.trim()) {
    return { valid: false, reason: 'empty' };
  }
  const result = await verifyLicenseOnline(key.trim());
  if (result.valid) saveLicense(key.trim());
  if (!result.valid && result.offline) return { valid: false, reason: 'network' };
  return result;
});

// ── IPC: settings ────────────────────────────────────────────────────────────
ipcMain.handle('settings:read', () => {
  return { ok: true, settings: readSettings() };
});

ipcMain.handle('settings:write', (_evt, data) => {
  try {
    saveSettings(data);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ── IPC: global shortcuts ────────────────────────────────────────────────────
function registerGlobalShortcuts(shortcuts) {
  // Unregister all existing
  globalShortcut.unregisterAll();
  registeredShortcuts = {};

  for (const [action, accelerator] of Object.entries(shortcuts)) {
    if (!accelerator) continue;
    try {
      const ok = globalShortcut.register(accelerator, () => {
        mainWindow?.webContents.send('shortcut:triggered', { action });
      });
      if (ok) registeredShortcuts[action] = accelerator;
    } catch (_) {}
  }
}

ipcMain.handle('shortcuts:register', (_evt, shortcuts) => {
  try {
    registerGlobalShortcuts(shortcuts || {});
    return { ok: true, registered: registeredShortcuts };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ── IPC: multi-monitor info ──────────────────────────────────────────────────
ipcMain.handle('monitors:list', () => {
  const { screen } = require('electron');
  const displays = screen.getAllDisplays();
  return {
    ok: true,
    displays: displays.map(d => ({
      id: d.id,
      label: d.label || `Display ${d.id}`,
      bounds: d.bounds,
      scaleFactor: d.scaleFactor,
      isPrimary: d.bounds.x === 0 && d.bounds.y === 0,
    })),
  };
});

// ── IPC: log file ────────────────────────────────────────────────────────────
ipcMain.handle('log:read', () => {
  try {
    if (!fs.existsSync(LOG_PATH)) return { ok: true, content: '(aucun log)' };
    const lines = fs.readFileSync(LOG_PATH, 'utf-8').split('\n');
    // Retourner les 300 dernières lignes
    return { ok: true, content: lines.slice(-300).join('\n'), path: LOG_PATH };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('log:open', () => {
  const { shell } = require('electron');
  if (fs.existsSync(LOG_PATH)) shell.openPath(LOG_PATH);
  return { ok: true };
});

ipcMain.handle('shell:openExternal', (_evt, url) => {
  const { shell } = require('electron');
  // Whitelist des protocoles autorisés (sécurité)
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    shell.openExternal(url);
  }
  return { ok: true };
});

ipcMain.handle('log:clear', () => {
  try {
    fs.writeFileSync(LOG_PATH, `[${_ts()}] [INFO] Log effacé\n`, 'utf-8');
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

app.on('will-quit', () => {
  writeLog('INFO', '═══ MacroEngine fermeture ═══');
  globalShortcut.unregisterAll();
});


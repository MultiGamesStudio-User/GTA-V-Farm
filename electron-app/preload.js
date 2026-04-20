'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // ── Engine lifecycle ──────────────────────────────────────
  startEngine:  ()       => ipcRenderer.invoke('engine:start'),
  stopEngine:   ()       => ipcRenderer.invoke('engine:stop'),
  engineStatus: ()       => ipcRenderer.invoke('engine:status'),

  // ── Engine commands (forwarded to Python) ─────────────────
  listWindows:       ()  => ipcRenderer.invoke('engine:list_windows'),
  getWindowRect:     (p) => ipcRenderer.invoke('engine:get_window_rect', p),
  getWindowInfo:     (p) => ipcRenderer.invoke('engine:get_window_info', p),
  isWindowFocused:   (p) => ipcRenderer.invoke('engine:is_window_focused', p),
  focusWindow:       (p) => ipcRenderer.invoke('engine:focus_window', p),
  getScreenInfo:     ()  => ipcRenderer.invoke('engine:get_screen_info'),
  findWindowMonitor: (p) => ipcRenderer.invoke('engine:find_window_monitor', p),

  // ── Coords ────────────────────────────────────────────────
  validatePoint:  (p) => ipcRenderer.invoke('engine:validate_point',  p),
  validateRegion: (p) => ipcRenderer.invoke('engine:validate_region', p),
  scaleCoords:    (p) => ipcRenderer.invoke('engine:scale_coords',    p),

  // ── Vision & OCR ─────────────────────────────────────────
  previewRegion:  (p) => ipcRenderer.invoke('engine:preview_region', p),
  pickColor:      (p) => ipcRenderer.invoke('engine:pick_color', p),
  checkOcr:       ()  => ipcRenderer.invoke('engine:check_ocr'),
  ocrText:        (p) => ipcRenderer.invoke('engine:ocr_text', p),

  // ── Conditions / Actions testing ─────────────────────────
  testCondition:  (p) => ipcRenderer.invoke('engine:test_condition', p),
  execAction:     (p) => ipcRenderer.invoke('engine:exec_action', p),

  // ── Webhook ───────────────────────────────────────────────
  setWebhook:  (p) => ipcRenderer.invoke('engine:set_webhook',  p),
  sendWebhook: (p) => ipcRenderer.invoke('engine:send_webhook', p),

  // ── Recording ─────────────────────────────────────────────
  recordStart: () => ipcRenderer.invoke('engine:record_start'),
  recordStop:  () => ipcRenderer.invoke('engine:record_stop'),

  // ── Macros ────────────────────────────────────────────────
  macroStart:  (p) => ipcRenderer.invoke('engine:macro_start',  p),
  macroStop:   (p) => ipcRenderer.invoke('engine:macro_stop',   p),
  macroPause:  (p) => ipcRenderer.invoke('engine:macro_pause',  p),
  macroResume: (p) => ipcRenderer.invoke('engine:macro_resume', p),
  stopAll:     ()  => ipcRenderer.invoke('engine:stop_all'),

  // ── State / Stats ─────────────────────────────────────────
  getStats:     (p) => ipcRenderer.invoke('engine:get_stats',     p),
  getVariables: ()  => ipcRenderer.invoke('engine:get_variables'),
  setVariable:  (p) => ipcRenderer.invoke('engine:set_variable',  p),
  setCounter:   (p) => ipcRenderer.invoke('engine:set_counter',   p),
  clearState:   ()  => ipcRenderer.invoke('engine:clear_state'),

  // ── Dead zones ────────────────────────────────────────────
  setDeadZones: (p) => ipcRenderer.invoke('engine:set_dead_zones', p),
  getDeadZones: ()  => ipcRenderer.invoke('engine:get_dead_zones'),

  // ── Pixel snapshot ────────────────────────────────────────
  pixelSnapshot: (p) => ipcRenderer.invoke('engine:pixel_snapshot', p),

  // ── Screen picker ─────────────────────────────────────────
  pickPoint:   ()      => ipcRenderer.invoke('picker:start', { mode: 'point' }),
  pickRegion:  ()      => ipcRenderer.invoke('picker:start', { mode: 'region' }),

  // ── Macros file (JSON persistence) ───────────────────────
  readMacros:  ()        => ipcRenderer.invoke('macros:read'),
  writeMacros: (macros)  => ipcRenderer.invoke('macros:write', macros),

  // ── Settings ──────────────────────────────────────────────
  readSettings: async () => {
    const r = await ipcRenderer.invoke('settings:read');
    // Unwrap the { ok, settings } envelope — return plain settings object
    return (r && r.settings !== undefined) ? r.settings : (r || {});
  },
  writeSettings: (data)  => ipcRenderer.invoke('settings:write', data),

  // ── Global shortcuts ──────────────────────────────────────
  registerShortcuts: (s) => ipcRenderer.invoke('shortcuts:register', s),
  onShortcutTriggered: (cb) => ipcRenderer.on('shortcut:triggered', (_, d) => cb(d)),

  // ── Multi-monitor ─────────────────────────────────────────
  listMonitors: ()       => ipcRenderer.invoke('monitors:list'),

  // ── Events (main → renderer) ──────────────────────────────
  onEngineLog:          (cb) => ipcRenderer.on('engine:log',               (_, d) => cb(d)),
  onEngineStatus:       (cb) => ipcRenderer.on('engine:status',            (_, d) => cb(d)),
  onEngineStatusUpd:    (cb) => ipcRenderer.on('engine:status_update',     (_, d) => cb(d)),
  onEngineStopped:      (cb) => ipcRenderer.on('engine:stopped',           (_, d) => cb(d)),
  onRecordEvent:        (cb) => ipcRenderer.on('engine:record_event',      (_, d) => cb(d)),
  onWebhookError:       (cb) => ipcRenderer.on('engine:webhook_error',     (_, d) => cb(d)),
  onMacroStartRequest:  (cb) => ipcRenderer.on('engine:macro_start_request',(_, d) => cb(d)),

  // ── Setup ─────────────────────────────────────────────────
  onSetupProgress: (cb) => ipcRenderer.on('setup:progress', (_, d) => cb(d)),
  onSetupDone:     (cb) => ipcRenderer.on('setup:done',     ()      => cb()),
  onSetupError:    (cb) => ipcRenderer.on('setup:error',    (_, d)  => cb(d)),

  // ── Overlay ───────────────────────────────────────────────
  showOverlay:     ()  => ipcRenderer.invoke('overlay:show'),
  hideOverlay:     ()  => ipcRenderer.invoke('overlay:hide'),
  toggleOverlay:   ()  => ipcRenderer.invoke('overlay:toggle'),
  onOverlayClosed: (cb) => ipcRenderer.on('overlay:closed', () => cb()),

  // ── Auto Clicker config (shared with overlay) ─────────────
  saveAcpConfig: (data) => ipcRenderer.invoke('acp:save-config', data),

  // ── App config ────────────────────────────────────────────
  getConfig: () => ipcRenderer.invoke('app:getConfig'),

  // ── License ───────────────────────────────────────────────
  checkLicense:  ()    => ipcRenderer.invoke('license:check'),
  verifyLicense: (key) => ipcRenderer.invoke('license:verify', key),

  // ── App ───────────────────────────────────────────────────────────────────
  restartApp:   ()    => ipcRenderer.invoke('app:restart'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

  // ── Log file ──────────────────────────────────────────────────────────────
  readLog:   ()  => ipcRenderer.invoke('log:read'),
  openLog:   ()  => ipcRenderer.invoke('log:open'),
  clearLog:  ()  => ipcRenderer.invoke('log:clear'),

  // ── Updater ───────────────────────────────────────────────
  checkUpdates:     ()   => ipcRenderer.invoke('updater:check'),
  onUpdaterChecking:  (cb) => ipcRenderer.on('updater:checking',   ()      => cb()),
  onUpdaterProgress:  (cb) => ipcRenderer.on('updater:progress',   (_, d)  => cb(d)),
  onUpdaterDone:      (cb) => ipcRenderer.on('updater:done',       (_, d)  => cb(d)),
  onUpdaterUpToDate:  (cb) => ipcRenderer.on('updater:up-to-date', (_, d)  => cb(d)),
  onUpdaterError:     (cb) => ipcRenderer.on('updater:error',      (_, d)  => cb(d)),

});

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlay', {
  onStatus:        (cb) => ipcRenderer.on('overlay:status',          (_, d) => cb(d)),
  onLog:           (cb) => ipcRenderer.on('overlay:log',             (_, d) => cb(d)),
  onStopped:       (cb) => ipcRenderer.on('overlay:stopped',         ()     => cb()),
  onMacrosUpdated: (cb) => ipcRenderer.on('overlay:macros-updated',  ()     => cb()),
  stopAll:         ()   => ipcRenderer.send('overlay:stop-all'),
  macroStart:      (name) => ipcRenderer.send('overlay:macro-start', { name }),
  macroStop:       (name) => ipcRenderer.send('overlay:macro-stop',  { name }),
  getMacros:       ()   => ipcRenderer.invoke('overlay:get-macros'),
  focusMain:       ()   => ipcRenderer.send('overlay:focus-main'),
  close:           ()   => ipcRenderer.send('overlay:close'),
  hide:            ()   => ipcRenderer.send('overlay:minimize'),
  // Auto Clicker
  acpStart:        (macro) => ipcRenderer.send('overlay:acp-start', { macro }),
  acpStop:         ()      => ipcRenderer.send('overlay:acp-stop'),
  onAcpStatus:     (cb)    => ipcRenderer.on('overlay:acp-status', (_, d) => cb(d)),
  getAcpConfig:    ()      => ipcRenderer.invoke('overlay:get-acp-config'),
  // Window control
  setSize:              (w, h) => ipcRenderer.send('overlay:set-size', { w, h }),
  getShortcuts:         ()     => ipcRenderer.invoke('overlay:get-shortcuts'),
  pauseAll:             ()     => ipcRenderer.send('overlay:pause-all'),
  onShortcutsUpdated:   (cb)   => ipcRenderer.on('overlay:shortcuts-updated', (_, d) => cb(d)),
});

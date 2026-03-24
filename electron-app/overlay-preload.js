'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlay', {
  onStatus:  (cb) => ipcRenderer.on('overlay:status',  (_, d) => cb(d)),
  onLog:     (cb) => ipcRenderer.on('overlay:log',     (_, d) => cb(d)),
  onStopped: (cb) => ipcRenderer.on('overlay:stopped', ()     => cb()),
  stopAll:   ()   => ipcRenderer.send('overlay:stop-all'),
  close:     ()   => ipcRenderer.send('overlay:close'),
  hide:      ()   => ipcRenderer.send('overlay:minimize'),
});

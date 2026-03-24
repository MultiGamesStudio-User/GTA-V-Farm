'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pickerApi', {
  onInit:     (cb) => ipcRenderer.on('picker:init', (_, d) => cb(d)),
  sendResult: (r)  => ipcRenderer.send('picker:result', r),
});

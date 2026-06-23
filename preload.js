const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ytmApp', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (partial) => ipcRenderer.invoke('settings:set', partial)
});

contextBridge.exposeInMainWorld('miniAPI', {
  toggle: () => ipcRenderer.invoke('mini:toggle'),
  status: () => ipcRenderer.invoke('mini:status'),
  getNowPlaying: () => ipcRenderer.invoke('nowPlaying:get'),
  onNowPlaying: (cb) => ipcRenderer.on('now-playing:update', (_e, data) => cb(data))
});
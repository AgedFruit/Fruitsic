const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ytmApp', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (partial) => ipcRenderer.invoke('settings:set', partial)
});

contextBridge.exposeInMainWorld('miniAPI', {
  toggle: () => ipcRenderer.invoke('mini:toggle'),
  status: () => ipcRenderer.invoke('mini:status'),
  getNowPlaying: () => ipcRenderer.invoke('nowPlaying:get'),

  onNowPlaying: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('now-playing:update', handler);
    return () => ipcRenderer.removeListener('now-playing:update', handler);
  },

  command: (name) => ipcRenderer.invoke('media:command', name),
  playPause: () => ipcRenderer.invoke('media:command', 'playPause'),
  next: () => ipcRenderer.invoke('media:command', 'next'),
  previous: () => ipcRenderer.invoke('media:command', 'previous')
});
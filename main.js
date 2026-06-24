const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const DEFAULT_DISCORD_CLIENT_ID = '1445465237359693877';
const envCandidates = [
  path.join(__dirname, '.env'),
  path.join(process.resourcesPath || '', '.env')
];

for (const p of envCandidates) {
  try {
    if (p && fs.existsSync(p)) {
      dotenv.config({ path: p });
      break;
    }
  } catch (_) {}
}

const { app, BrowserWindow, ipcMain, session, globalShortcut } = require('electron');
const log = require('electron-log');
const { DiscordPresence } = require('./rpc');
const { startExpressServer } = require('./express-server');
const { readSettings, writeSettings } = require('./settings');

const YTM_URL = 'https://music.youtube.com';
const EXPRESS_PORT = Number(process.env.EXPRESS_PORT || 3977);
const UPDATE_HEARTBEAT_MS = 15000;

let win;
let miniWin = null;
let expressServer;
let settings;
let rpc = null;

let nowPlaying = {
  title: '',
  artist: '',
  currentTimeSec: 0,
  durationSec: 0,
  paused: false,
  albumArt: ''
};

let lastPresencePushAt = 0;
let lastSnapshot = null;

function classifyChange(prev, next) {
  if (!prev) return 'init';
  if (prev.title !== next.title || prev.artist !== next.artist) return 'track-change';
  if (prev.paused !== next.paused) return 'playback-toggle';

  const dt = Math.abs((next.currentTimeSec || 0) - (prev.currentTimeSec || 0));
  if (dt >= 3) return 'seek';

  return 'tick';
}

function shouldPushPresence(next) {
  const now = Date.now();
  const changeType = classifyChange(lastSnapshot, next);

  const immediate =
    changeType === 'init' ||
    changeType === 'track-change' ||
    changeType === 'playback-toggle' ||
    changeType === 'seek';

  const heartbeatDue = now - lastPresencePushAt >= UPDATE_HEARTBEAT_MS;

  if (immediate || heartbeatDue) {
    lastPresencePushAt = now;
    lastSnapshot = { ...next };
    return true;
  }

  lastSnapshot = { ...next };
  return false;
}

async function rebuildRpcFromSettings(oldSettings, newSettings) {
  const oldId = (oldSettings?.discordClientId || '').trim();
  const newId = (newSettings?.discordClientId || '').trim();
  const oldEnabled = !!oldSettings?.discordEnabled;
  const newEnabled = !!newSettings?.discordEnabled;

  const idChanged = oldId !== newId;
  const enabledChanged = oldEnabled !== newEnabled;

  if (!idChanged && !enabledChanged) return;

  if (rpc) {
    try {
      await rpc.destroy();
    } catch (e) {
      log.warn('[RPC] destroy failed during rebuild', e?.message);
    }
  }

  rpc = new DiscordPresence(newId);

  if (newEnabled && newId) {
    setTimeout(() => {
      try {
        rpc.connect();
      } catch (e) {
        log.warn('[RPC] reconnect failed after settings change', e?.message);
      }
    }, 1000);
  }
}

async function applySettingsPartial(partial) {
  const previous = { ...settings };

  settings = {
    ...settings,
    ...partial,
    pollMs: Math.max(2000, Number(partial.pollMs ?? settings.pollMs)),
    discordClientId: String(partial.discordClientId ?? settings.discordClientId ?? '').trim()
  };

  writeSettings(settings);

  await rebuildRpcFromSettings(previous, settings);

  if (!settings.discordEnabled && rpc) {
    try {
      await rpc.clear();
    } catch (e) {
      log.warn('[RPC] clear failed after disable', e?.message);
    }
  }

  return settings;
}

async function setupRealtimeTrackBridge() {
  if (!win || win.isDestroyed()) return;

  win.webContents.on('console-message', async (_e, _level, message) => {
    if (!message.startsWith('__YTM_TRACK__')) return;

    try {
      const payload = JSON.parse(message.slice('__YTM_TRACK__'.length));

      nowPlaying = {
        title: payload.title || '',
        artist: payload.artist || '',
        currentTimeSec: Number(payload.currentTimeSec) || 0,
        durationSec: Number(payload.durationSec) || 0,
        paused: !!payload.paused,
        albumArt: payload.albumArt || ''
      };

      try {
        if (miniWin && !miniWin.isDestroyed()) {
          miniWin.webContents.send('now-playing:update', nowPlaying);
        }
      } catch (e) {
        log.warn('[Mini] update failed', e?.message);
      }

      if (!nowPlaying.title || !settings.discordEnabled) return;
      if (!rpc) return;
      if (!shouldPushPresence(nowPlaying)) return;

      await rpc.setNowPlaying(
        nowPlaying.title,
        nowPlaying.artist,
        nowPlaying.currentTimeSec,
        nowPlaying.durationSec,
        nowPlaying.paused
      );
    } catch (err) {
      log.warn('[Bridge] handler error', err?.message);
    }
  });

  await win.webContents.executeJavaScript(
    `
    (() => {
      if (window.__ytmRpcInstalled) return;
      window.__ytmRpcInstalled = true;

      function parseClock(text) {
        if (!text) return 0;
        const p = text.trim().split(':').map(n => parseInt(n, 10));
        if (p.some(Number.isNaN)) return 0;
        if (p.length === 2) return p[0] * 60 + p[1];
        if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
        return 0;
      }

      function readTrack() {
        const audio = document.querySelector('audio');
        let currentTimeSec = audio && Number.isFinite(audio.currentTime) ? Math.floor(audio.currentTime) : 0;
        let durationSec = audio && Number.isFinite(audio.duration) ? Math.floor(audio.duration) : 0;
        const paused = audio ? !!audio.paused : false;

        const timeInfo = document.querySelector('.time-info')?.textContent || '';
        const m = timeInfo.replace(/\\s+/g, ' ').match(/(\\d{1,2}:\\d{2}(?::\\d{2})?)\\s*\\/\\s*(\\d{1,2}:\\d{2}(?::\\d{2})?)/);
        if ((!currentTimeSec || !durationSec) && m) {
          currentTimeSec = parseClock(m[1]);
          durationSec = parseClock(m[2]);
        }

        const ms = (typeof navigator !== 'undefined' && navigator.mediaSession) ? navigator.mediaSession : null;
        const meta = ms && ms.metadata ? ms.metadata : null;

        const title = (meta && meta.title ? meta.title : document.title.replace(' - YouTube Music', '').trim() || '').trim();
        const artist = (meta && meta.artist ? meta.artist : '').trim();

        let albumArt = '';
        try {
          const rawArtwork = meta && Array.isArray(meta.artwork) ? meta.artwork : [];
          if (rawArtwork.length) {
            const withSize = rawArtwork.map((a) => {
              const sizeText = (a && typeof a.sizes === 'string') ? a.sizes : '';
              const first = sizeText.split(' ')[0] || '0x0';
              const w = parseInt(first.split('x')[0], 10) || 0;
              return { src: a && a.src ? a.src : '', w };
            }).filter(x => !!x.src);

            withSize.sort((a, b) => b.w - a.w);
            albumArt = withSize[0] ? withSize[0].src : '';
          }
        } catch (_) {}

        return { title, artist, currentTimeSec, durationSec, paused, albumArt };
      }

      function emit() {
        try {
          const data = readTrack();
          console.log('__YTM_TRACK__' + JSON.stringify(data));
        } catch (e) {
          console.warn('__YTM_TRACK_ERR__' + (e && e.message ? e.message : 'unknown'));
        }
      }

      const attachAudio = () => {
        const audio = document.querySelector('audio');
        if (!audio || audio.__ytmRpcBound) return;
        audio.__ytmRpcBound = true;

        ['play', 'pause', 'seeking', 'seeked', 'loadedmetadata', 'durationchange', 'timeupdate', 'ended']
          .forEach(evt => audio.addEventListener(evt, emit, { passive: true }));
      };

      const observer = new MutationObserver(() => {
        attachAudio();
        emit();
      });
      observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

      attachAudio();
      emit();
      setInterval(emit, 5000);
    })();
  `,
    true
  );
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.loadURL(YTM_URL);

  win.webContents.on('did-finish-load', async () => {
    await setupRealtimeTrackBridge();
  });
}

function createMiniWindow() {
  if (miniWin && !miniWin.isDestroyed()) {
    miniWin.show();
    miniWin.focus();
    return;
  }

  miniWin = new BrowserWindow({
    width: 360,
    height: 120,
    resizable: false,
    maximizable: false,
    minimizable: true,
    alwaysOnTop: true,
    autoHideMenuBar: true,
    frame: false,
    titleBarStyle: 'hidden',
    transparent: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  miniWin.loadFile(path.join(__dirname, 'mini.html'));

  miniWin.on('closed', () => {
    miniWin = null;
  });
}

function closeMiniWindow() {
  if (miniWin && !miniWin.isDestroyed()) miniWin.close();
}

function setupIPC() {
  ipcMain.handle('settings:get', async () => settings);

  ipcMain.handle('settings:set', async (_evt, partial) => {
    return applySettingsPartial(partial || {});
  });

  ipcMain.handle('mini:toggle', async () => {
    if (miniWin && !miniWin.isDestroyed()) {
      closeMiniWindow();
      return { open: false };
    }
    createMiniWindow();
    return { open: true };
  });

  ipcMain.handle('mini:status', async () => ({
    open: !!(miniWin && !miniWin.isDestroyed())
  }));

  ipcMain.handle('nowPlaying:get', async () => nowPlaying);
}

function setupExpress() {
  expressServer = startExpressServer({
    port: EXPRESS_PORT,
    getStatus: () => ({
      nowPlaying,
      discordEnabled: settings.discordEnabled,
      pollMs: settings.pollMs,
      discordClientId: settings.discordClientId || ''
    }),
    getSettings: () => settings,
    updateSettings: async (partial) => {
      return applySettingsPartial(partial || {});
    }
  });
}

app.whenReady().then(async () => {
  settings = readSettings();

const envClientId = (process.env.DISCORD_CLIENT_ID || '').trim();
const effectiveClientId =
  (settings.discordClientId || '').trim() ||
  envClientId ||
  DEFAULT_DISCORD_CLIENT_ID;

if (!settings.discordClientId && effectiveClientId) {
  settings.discordClientId = effectiveClientId;
  writeSettings(settings);
}

rpc = new DiscordPresence(effectiveClientId);

  session.defaultSession.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));

  globalShortcut.register('CommandOrControl+Shift+M', () => {
    if (miniWin && !miniWin.isDestroyed()) {
      miniWin.close();
    } else {
      createMiniWindow();
    }
  });

  createWindow();
  setupIPC();
  setupExpress();

  if (settings.discordEnabled && (settings.discordClientId || '').trim()) {
    setTimeout(() => {
      try {
        rpc.connect();
      } catch (e) {
        log.warn('[RPC] initial connect failed', e?.message);
      }
    }, 4000);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async () => {
  if (expressServer) expressServer.close();
  if (rpc) await rpc.destroy();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
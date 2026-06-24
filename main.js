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

let win;
let miniWin = null;
let expressServer;
let settings;
let rpc = null;

let nowPlaying = {
  title: '',
  artist: '',
  album: '',
  currentTimeSec: 0,
  durationSec: 0,
  paused: false,
  albumArt: '',
  trackUrl: ''
};

let presencePollTimer = null;
let lastPushedPresence = {
  title: '',
  artist: '',
  album: '',
  paused: null,
  currentBucket: -1,
  phase: -1
};

function currentPhase10s() {
  return Math.floor(Date.now() / 10000) % 2;
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

  // apply preset immediately on rebuilt client
  if (rpc && typeof rpc.setDisplayPreset === 'function') {
    rpc.setDisplayPreset(newSettings?.rpcDisplayPreset || 'clean');
  }

  lastPushedPresence = {
    title: '',
    artist: '',
    album: '',
    paused: null,
    currentBucket: -1,
    phase: -1
  };

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
    discordClientId: String(partial.discordClientId ?? settings.discordClientId ?? '').trim(),
    rpcDisplayPreset: String(partial.rpcDisplayPreset ?? settings.rpcDisplayPreset ?? 'clean')
      .trim()
      .toLowerCase()
  };

  writeSettings(settings);
  await rebuildRpcFromSettings(previous, settings);

  // live-apply preset even if RPC client did not rebuild
  if (rpc && typeof rpc.setDisplayPreset === 'function') {
    rpc.setDisplayPreset(settings.rpcDisplayPreset);
  }

  if (!settings.discordEnabled && rpc) {
    try {
      await rpc.clear();
    } catch (e) {
      log.warn('[RPC] clear failed after disable', e?.message);
    }
  }

  // force immediate refresh so preset change is visible now
  if (rpc && settings.discordEnabled && nowPlaying?.title) {
    try {
      await rpc.setNowPlaying(
        nowPlaying.title,
        nowPlaying.artist,
        nowPlaying.currentTimeSec,
        nowPlaying.durationSec,
        nowPlaying.paused,
        nowPlaying.album || '',
        nowPlaying.trackUrl || 'https://music.youtube.com'
      );
    } catch (e) {
      log.warn('[RPC] immediate refresh after preset change failed', e?.message);
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
        album: payload.album || '',
        currentTimeSec: Number(payload.currentTimeSec) || 0,
        durationSec: Number(payload.durationSec) || 0,
        paused: !!payload.paused,
        albumArt: payload.albumArt || '',
        trackUrl: payload.trackUrl || ''
      };

      try {
        if (miniWin && !miniWin.isDestroyed()) {
          miniWin.webContents.send('now-playing:update', nowPlaying);
        }
      } catch (e) {
        log.warn('[Mini] update failed', e?.message);
      }
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

      function pickMedia() {
        const nodes = Array.from(document.querySelectorAll('audio,video'));
        if (!nodes.length) return null;

        let m = nodes.find(el =>
          !el.paused &&
          Number.isFinite(el.currentTime) &&
          (Number.isFinite(el.duration) ? el.duration > 0 : true) &&
          !el.muted &&
          el.volume > 0
        );
        if (m) return m;

        m = nodes.find(el => !el.paused);
        if (m) return m;

        nodes.sort((a, b) => (b.duration || 0) - (a.duration || 0));
        return nodes[0] || null;
      }

      function looksLikeTrackCount(text) {
        return /\\b\\d+\\s*(song|songs|track|tracks)\\b/i.test(text);
      }

      function readAlbumFallback() {
        const albumLinkSelectors = [
          'ytmusic-player-bar .byline a[href*="browse/"]',
          '.middle-controls .byline a[href*="browse/"]',
          'ytmusic-player-bar .subtitle a[href*="browse/"]'
        ];

        for (const sel of albumLinkSelectors) {
          const links = Array.from(document.querySelectorAll(sel));
          for (const a of links) {
            const txt = (a.textContent || '').trim();
            if (!txt) continue;
            if (looksLikeTrackCount(txt)) continue;
            return txt;
          }
        }

        const bylineSelectors = [
          '.middle-controls .byline.ytmusic-player-bar',
          'ytmusic-player-bar .byline',
          'ytmusic-player-bar .subtitle',
          '.subtitle',
          '.byline',
          '[class*="byline"]',
          '[class*="subtitle"]'
        ];

        for (const sel of bylineSelectors) {
          const nodes = Array.from(document.querySelectorAll(sel));
          for (const n of nodes) {
            const txt = (n.textContent || '').replace(/\\s+/g, ' ').trim();
            if (!txt) continue;

            const parts = txt.split('•').map(s => s.trim()).filter(Boolean);
            if (!parts.length) continue;

            const candidates = parts.slice(1).filter(p => !looksLikeTrackCount(p));
            if (candidates.length) return candidates[0];
          }
        }

        return '';
      }

      function readTrack() {
        const media = pickMedia();

        let currentTimeSec = media && Number.isFinite(media.currentTime) ? Math.floor(media.currentTime) : 0;
        let durationSec = media && Number.isFinite(media.duration) ? Math.floor(media.duration) : 0;
        const paused = media ? !!media.paused : true;

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
        const album = ((meta && meta.album ? meta.album : '') || readAlbumFallback()).trim();

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

        return { title, artist, album, currentTimeSec, durationSec, paused, albumArt, trackUrl: location.href };
      }

      function emit() {
        try {
          const data = readTrack();
          console.log('__YTM_TRACK__' + JSON.stringify(data));
        } catch (e) {
          console.warn('__YTM_TRACK_ERR__' + (e && e.message ? e.message : 'unknown'));
        }
      }

      function attachMedia() {
        Array.from(document.querySelectorAll('audio,video')).forEach((media) => {
          if (!media || media.__ytmRpcBound) return;
          media.__ytmRpcBound = true;

          ['play', 'pause', 'seeking', 'seeked', 'loadedmetadata', 'durationchange', 'timeupdate', 'ended']
            .forEach(evt => media.addEventListener(evt, emit, { passive: true }));
        });
      }

      const observer = new MutationObserver(() => {
        attachMedia();
        emit();
      });

      observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

      attachMedia();
      emit();
      setInterval(emit, 5000);
    })();
  `,
    true
  );
}

async function readTrackForPresence() {
  if (!win || win.isDestroyed()) return null;

  try {
    return await win.webContents.executeJavaScript(
      `
      (() => {
        function pickMedia() {
          const nodes = Array.from(document.querySelectorAll('audio,video'));
          if (!nodes.length) return null;

          let m = nodes.find(el =>
            !el.paused &&
            Number.isFinite(el.currentTime) &&
            (Number.isFinite(el.duration) ? el.duration > 0 : true) &&
            !el.muted &&
            el.volume > 0
          );
          if (m) return m;

          m = nodes.find(el => !el.paused);
          if (m) return m;

          nodes.sort((a, b) => (b.duration || 0) - (a.duration || 0));
          return nodes[0] || null;
        }

        function looksLikeTrackCount(text) {
          return /\\b\\d+\\s*(song|songs|track|tracks)\\b/i.test(text);
        }

        function readAlbumFallback() {
          const albumLinkSelectors = [
            'ytmusic-player-bar .byline a[href*="browse/"]',
            '.middle-controls .byline a[href*="browse/"]',
            'ytmusic-player-bar .subtitle a[href*="browse/"]'
          ];

          for (const sel of albumLinkSelectors) {
            const links = Array.from(document.querySelectorAll(sel));
            for (const a of links) {
              const txt = (a.textContent || '').trim();
              if (!txt) continue;
              if (looksLikeTrackCount(txt)) continue;
              return txt;
            }
          }

          const bylineSelectors = [
            '.middle-controls .byline.ytmusic-player-bar',
            'ytmusic-player-bar .byline',
            'ytmusic-player-bar .subtitle',
            '.subtitle',
            '.byline',
            '[class*="byline"]',
            '[class*="subtitle"]'
          ];

          for (const sel of bylineSelectors) {
            const nodes = Array.from(document.querySelectorAll(sel));
            for (const n of nodes) {
              const txt = (n.textContent || '').replace(/\\s+/g, ' ').trim();
              if (!txt) continue;

              const parts = txt.split('•').map(s => s.trim()).filter(Boolean);
              if (!parts.length) continue;

              const candidates = parts.slice(1).filter(p => !looksLikeTrackCount(p));
              if (candidates.length) return candidates[0];
            }
          }

          return '';
        }

        const media = pickMedia();
        const ms = (typeof navigator !== 'undefined' && navigator.mediaSession) ? navigator.mediaSession : null;
        const meta = ms && ms.metadata ? ms.metadata : null;

        const title = (meta && meta.title ? meta.title : document.title.replace(' - YouTube Music', '').trim() || '').trim();
        const artist = (meta && meta.artist ? meta.artist : '').trim();
        const album = ((meta && meta.album ? meta.album : '') || readAlbumFallback()).trim();

        const currentTimeSec = media && Number.isFinite(media.currentTime) ? Math.floor(media.currentTime) : 0;
        const durationSec = media && Number.isFinite(media.duration) ? Math.floor(media.duration) : 0;
        const paused = media ? !!media.paused : true;

        return { title, artist, album, currentTimeSec, durationSec, paused, trackUrl: location.href };
      })();
      `,
      true
    );
  } catch (e) {
    log.warn('[Presence poll] read failed', e?.message);
    return null;
  }
}

function shouldPushPolledPresence(next) {
  if (!next?.title) return false;

  const bucket = next.paused
    ? Math.floor((next.currentTimeSec || 0) / 5)
    : Math.floor((next.currentTimeSec || 0) / 20);

  const phase = currentPhase10s();

  const trackChanged =
    next.title !== lastPushedPresence.title ||
    next.artist !== lastPushedPresence.artist ||
    (next.album || '') !== (lastPushedPresence.album || '');

  const pauseChanged = next.paused !== lastPushedPresence.paused;
  const bucketChanged = bucket !== lastPushedPresence.currentBucket;
  const phaseChanged = phase !== lastPushedPresence.phase;

  if (trackChanged || pauseChanged || bucketChanged || phaseChanged) {
    lastPushedPresence = {
      title: next.title,
      artist: next.artist,
      album: next.album || '',
      paused: next.paused,
      currentBucket: bucket,
      phase
    };
    return true;
  }

  return false;
}

function startPresencePolling() {
  if (presencePollTimer) clearInterval(presencePollTimer);

  presencePollTimer = setInterval(async () => {
    try {
      if (!settings?.discordEnabled || !rpc) return;

      const p = await readTrackForPresence();
      if (!p || !p.title) return;
      if (!shouldPushPolledPresence(p)) return;

      log.info('[Presence poll push]', {
        title: p.title,
        artist: p.artist,
        album: p.album,
        paused: p.paused,
        currentTimeSec: p.currentTimeSec,
        durationSec: p.durationSec,
        phase: currentPhase10s(),
        preset: settings?.rpcDisplayPreset || 'clean'
      });

      await rpc.setNowPlaying(
        p.title,
        p.artist,
        p.currentTimeSec,
        p.durationSec,
        p.paused,
        p.album || '',
        p.trackUrl || 'https://music.youtube.com'
      );
    } catch (e) {
      log.warn('[Presence poll] push failed', e?.message);
    }
  }, 800);
}

function stopPresencePolling() {
  if (presencePollTimer) {
    clearInterval(presencePollTimer);
    presencePollTimer = null;
  }
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
      discordClientId: settings.discordClientId || '',
      rpcDisplayPreset: settings.rpcDisplayPreset || 'clean'
    }),
    getSettings: () => settings,
    updateSettings: async (partial) => {
      return applySettingsPartial(partial || {});
    }
  });
}

app.whenReady().then(async () => {
  settings = readSettings();

  // defaults
  if (!settings.rpcDisplayPreset) {
    settings.rpcDisplayPreset = 'clean';
  }

  const envClientId = (process.env.DISCORD_CLIENT_ID || '').trim();
  const effectiveClientId =
    (settings.discordClientId || '').trim() ||
    envClientId ||
    DEFAULT_DISCORD_CLIENT_ID;

  if (!settings.discordClientId && effectiveClientId) {
    settings.discordClientId = effectiveClientId;
  }

  writeSettings(settings);

  rpc = new DiscordPresence(effectiveClientId);

  // apply preset on startup
  if (rpc && typeof rpc.setDisplayPreset === 'function') {
    rpc.setDisplayPreset(settings.rpcDisplayPreset || 'clean');
  }

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
  startPresencePolling();

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
  stopPresencePolling();
  if (expressServer) expressServer.close();
  if (rpc) await rpc.destroy();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
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

let lastAutoSkippedTrackKey = '';
let rickrollSkipCooldownUntil = 0;
let mediaCommandInFlight = false;

function currentPhase10s() {
  return Math.floor(Date.now() / 10000) % 2;
}

function norm(s = '') {
  return String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function looksLikeRickrollText(title = '', artist = '', pageTitle = '') {
  const t = norm(title);
  const a = norm(artist);
  const p = norm(String(pageTitle || '').replace(' - youtube music', ''));

  const strong =
    t.includes('never gonna give you up') ||
    t.includes('never going to give you up') ||
    p.includes('never gonna give you up') ||
    p.includes('never going to give you up');

  if (strong) return true;

  const partial =
    t.includes('never gonna give you') ||
    t.includes('give you up') ||
    p.includes('never gonna give you') ||
    p.includes('give you up');

  const rickCtx =
    a.includes('rick astley') ||
    a.includes('astley') ||
    p.includes('rick astley');

  return partial && rickCtx;
}

function isRickrollByTitleArtist(title = '', artist = '') {
  const t = norm(title);
  const a = norm(artist);

  const strongTitle =
    t.includes('never gonna give you up') ||
    t.includes('never going to give you up');

  if (strongTitle) return true;

  const partialTitle =
    t.includes('never gonna give you') ||
    t.includes('give you up');

  const rickCtx =
    a.includes('rick astley') ||
    a.includes('astley');

  return partialTitle && rickCtx;
}

async function isRickrollNowFromPage() {
  if (!win || win.isDestroyed()) return false;
  try {
    return await win.webContents.executeJavaScript(
      `
      (() => {
        const norm = (s='') => String(s).toLowerCase()
          .normalize('NFKD')
          .replace(/[\\u0300-\\u036f]/g, '')
          .replace(/[^a-z0-9]+/g, ' ')
          .trim();

        const ms = navigator.mediaSession && navigator.mediaSession.metadata ? navigator.mediaSession.metadata : null;
        const title = norm(ms && ms.title ? ms.title : '');
        const artist = norm(ms && ms.artist ? ms.artist : '');
        const pageTitle = norm(String(document.title || '').replace(' - YouTube Music', ''));

        const strong =
          title.includes('never gonna give you up') ||
          title.includes('never going to give you up') ||
          pageTitle.includes('never gonna give you up') ||
          pageTitle.includes('never going to give you up');

        if (strong) return true;

        const partial =
          title.includes('never gonna give you') ||
          title.includes('give you up') ||
          pageTitle.includes('never gonna give you') ||
          pageTitle.includes('give you up');

        const rickCtx =
          artist.includes('rick astley') ||
          artist.includes('astley') ||
          pageTitle.includes('rick astley');

        return !!(partial && rickCtx);
      })();
      `,
      true
    );
  } catch (_) {
    return false;
  }
}

async function sendMiniToast(message) {
  try {
    if (miniWin && !miniWin.isDestroyed()) {
      miniWin.webContents.send('mini:toast', { message, ts: Date.now() });
    }
  } catch (_) {}
}

async function sendMainToast(message) {
  if (!win || win.isDestroyed()) return false;
  try {
    return await win.webContents.executeJavaScript(`
      (() => {
        const msg = ${JSON.stringify(String(message || ''))};

        let host = document.getElementById('__ytm_rpc_toast');
        if (!host) {
          host = document.createElement('div');
          host.id = '__ytm_rpc_toast';
          host.style.position = 'fixed';
          host.style.left = '50%';
          host.style.bottom = '24px';
          host.style.transform = 'translateX(-50%) translateY(8px)';
          host.style.background = 'rgba(20,20,20,0.92)';
          host.style.color = '#fff';
          host.style.padding = '10px 14px';
          host.style.borderRadius = '10px';
          host.style.fontSize = '13px';
          host.style.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
          host.style.zIndex = '2147483647';
          host.style.opacity = '0';
          host.style.transition = 'opacity .15s ease, transform .15s ease';
          host.style.pointerEvents = 'none';
          host.style.border = '1px solid rgba(255,255,255,.12)';
          document.documentElement.appendChild(host);
        }

        host.textContent = msg;
        host.style.opacity = '1';
        host.style.transform = 'translateX(-50%) translateY(0)';

        clearTimeout(window.__ytmRpcToastTimer);
        window.__ytmRpcToastTimer = setTimeout(() => {
          const el = document.getElementById('__ytm_rpc_toast');
          if (!el) return;
          el.style.opacity = '0';
          el.style.transform = 'translateX(-50%) translateY(8px)';
        }, 5500);

        return true;
      })();
    `, true);
  } catch {
    return false;
  }
}

async function triggerMediaCommand(command) {
  if (mediaCommandInFlight) return false;
  mediaCommandInFlight = true;

  try {
    if (!win || win.isDestroyed()) return false;
    const cmd = String(command || '').trim();

    return await win.webContents.executeJavaScript(
      `
      (() => {
        const command = ${JSON.stringify(cmd)};

        const fireClick = (el) => {
          if (!el) return false;
          try { el.click(); return true; } catch (_) {}
          try {
            el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
            el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
            return true;
          } catch (_) {}
          return false;
        };

        const clickAny = (selectors) => {
          for (const s of selectors) {
            const el = document.querySelector(s);
            if (!el) continue;
            if (fireClick(el)) return true;

            const hostBtn = el.closest && el.closest('tp-yt-paper-icon-button, button');
            if (hostBtn && fireClick(hostBtn)) return true;
          }
          return false;
        };

        if (command === 'playPause') {
          if (clickAny([
            'ytmusic-player-bar tp-yt-paper-icon-button#play-pause-button',
            'ytmusic-player-bar #play-pause-button',
            'ytmusic-player-bar button[aria-label*="Pause"]',
            'ytmusic-player-bar button[aria-label*="Play"]'
          ])) return true;

          const m = document.querySelector('audio,video');
          if (m) { m.paused ? m.play().catch(() => {}) : m.pause(); return true; }
          return false;
        }

        if (command === 'next') {
          if (clickAny([
            'ytmusic-player-bar tp-yt-paper-icon-button#next-button',
            'ytmusic-player-bar #next-button',
            'ytmusic-player-bar #next-button tp-yt-iron-icon',
            'ytmusic-player-bar #next-button yt-icon',
            'ytmusic-player-bar tp-yt-paper-icon-button[title*="Next"]',
            'ytmusic-player-bar button[aria-label*="Next"]'
          ])) return true;
          return false;
        }

        if (command === 'previous') {
          if (clickAny([
            'ytmusic-player-bar tp-yt-paper-icon-button#previous-button',
            'ytmusic-player-bar #previous-button',
            'ytmusic-player-bar #previous-button tp-yt-iron-icon',
            'ytmusic-player-bar #previous-button yt-icon',
            'ytmusic-player-bar tp-yt-paper-icon-button[title*="Previous"]',
            'ytmusic-player-bar button[aria-label*="Previous"]'
          ])) return true;
          return false;
        }

        return false;
      })();
      `,
      true
    );
  } catch {
    return false;
  } finally {
    setTimeout(() => {
      mediaCommandInFlight = false;
    }, 120);
  }
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
      .toLowerCase(),
    rickrollJokeMode: typeof partial.rickrollJokeMode === 'boolean'
      ? partial.rickrollJokeMode
      : !!settings.rickrollJokeMode
  };

  writeSettings(settings);
  await rebuildRpcFromSettings(previous, settings);

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

      if (settings?.rickrollJokeMode) {
        const hit = isRickrollByTitleArtist(nowPlaying.title, nowPlaying.artist);
        if (hit && Date.now() > rickrollSkipCooldownUntil) {
          rickrollSkipCooldownUntil = Date.now() + 5000;

          const skipped = await triggerMediaCommand('next');
          await sendMainToast('🥸 Nice try. Rickroll auto-skipped.');
          await triggerMediaCommand('playPause');
        }
      }

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

      function getCurrentTrackUrl(media) {
        const normalize = (raw) => {
          if (!raw) return '';
          try {
            const u = new URL(raw, location.origin);

            let v = u.searchParams.get('v');
            if (!v) {
              const m = u.pathname.match(/\\/watch\\/([a-zA-Z0-9_-]{6,})/);
              if (m) v = m[1];
            }
            if (!v) {
              const m2 = String(raw).match(/[?&]v=([a-zA-Z0-9_-]{6,})/);
              if (m2) v = m2[1];
            }

            if (v) return \`https://music.youtube.com/watch?v=\${encodeURIComponent(v)}\`;
            return '';
          } catch (_) {
            return '';
          }
        };

        const fromMedia = normalize(media && (media.currentSrc || media.src));
        if (fromMedia) return fromMedia;

        const ms = (typeof navigator !== 'undefined' && navigator.mediaSession) ? navigator.mediaSession : null;
        const meta = ms && ms.metadata ? ms.metadata : null;
        const fromMeta = normalize(meta && meta.url);
        if (fromMeta) return fromMeta;

        const selectors = [
          'ytmusic-player-bar .title a[href]',
          '.middle-controls .title a[href]',
          'a[href*="watch?v="]'
        ];

        for (const sel of selectors) {
          const a = document.querySelector(sel);
          const fromA = normalize(a && a.getAttribute('href'));
          if (fromA) return fromA;
        }

        return 'https://music.youtube.com';
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

        return { title, artist, album, currentTimeSec, durationSec, paused, albumArt, trackUrl: getCurrentTrackUrl(media) };
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

        function getCurrentTrackUrl(media) {
          const normalize = (raw) => {
            if (!raw) return '';
            try {
              const u = new URL(raw, location.origin);

              let v = u.searchParams.get('v');
              if (!v) {
                const m = u.pathname.match(/\\/watch\\/([a-zA-Z0-9_-]{6,})/);
                if (m) v = m[1];
              }
              if (!v) {
                const m2 = String(raw).match(/[?&]v=([a-zA-Z0-9_-]{6,})/);
                if (m2) v = m2[1];
              }

              if (v) return \`https://music.youtube.com/watch?v=\${encodeURIComponent(v)}\`;
              return '';
            } catch (_) {
              return '';
            }
          };

          const fromMedia = normalize(media && (media.currentSrc || media.src));
          if (fromMedia) return fromMedia;

          const ms = (typeof navigator !== 'undefined' && navigator.mediaSession) ? navigator.mediaSession : null;
          const meta = ms && ms.metadata ? ms.metadata : null;
          const fromMeta = normalize(meta && meta.url);
          if (fromMeta) return fromMeta;

          const selectors = [
            'ytmusic-player-bar .title a[href]',
            '.middle-controls .title a[href]',
            'a[href*="watch?v="]'
          ];

          for (const sel of selectors) {
            const a = document.querySelector(sel);
            const fromA = normalize(a && a.getAttribute('href'));
            if (fromA) return fromA;
          }

          return 'https://music.youtube.com';
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

        return { title, artist, album, currentTimeSec, durationSec, paused, trackUrl: getCurrentTrackUrl(media) };
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

      if (settings?.rickrollJokeMode) {
        const pageDetect = await isRickrollNowFromPage();
        const localDetect = looksLikeRickrollText(p.title, p.artist, p.title || '');

        if (pageDetect || localDetect) {
          const key = `${norm(p.title)}|${norm(p.artist)}|rickroll`;
          if (key !== lastAutoSkippedTrackKey) {
            lastAutoSkippedTrackKey = key;

            const skipped = await triggerMediaCommand('next');

            await sendMiniToast(
              skipped
                ? '🥸 Nice try. Rickroll auto-skipped.'
                : '🥸 Rickroll detected, but skip failed.'
            );

            return;
          }
        } else {
          lastAutoSkippedTrackKey = '';
        }
      }

      if (!shouldPushPolledPresence(p)) return;

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
    height: 150,
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

  ipcMain.handle('media:command', async (_evt, command) => {
    return triggerMediaCommand(command);
  });
}

function setupExpress() {
  expressServer = startExpressServer({
    port: EXPRESS_PORT,
    getStatus: () => ({
      nowPlaying,
      discordEnabled: settings.discordEnabled,
      pollMs: settings.pollMs,
      discordClientId: settings.discordClientId || '',
      rpcDisplayPreset: settings.rpcDisplayPreset || 'clean',
      rickrollJokeMode: !!settings.rickrollJokeMode
    }),
    getSettings: () => settings,
    updateSettings: async (partial) => {
      return applySettingsPartial(partial || {});
    }
  });
}

app.whenReady().then(async () => {
  settings = readSettings();

  if (!settings.rpcDisplayPreset) {
    settings.rpcDisplayPreset = 'clean';
  }
  if (typeof settings.rickrollJokeMode !== 'boolean') {
    settings.rickrollJokeMode = false;
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
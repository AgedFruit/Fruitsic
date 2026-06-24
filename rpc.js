const RPC = require('discord-rpc');
const log = require('electron-log');

class DiscordPresence {
  constructor(clientId) {
    this.clientId = clientId;
    this.rpc = null;
    this.ready = false;
  }

  async connect(retries = 8) {
    if (!this.clientId) {
      log.warn('[RPC] Missing DISCORD_CLIENT_ID');
      return;
    }

    RPC.register(this.clientId);

    for (let i = 0; i < retries; i++) {
      this.rpc = new RPC.Client({ transport: 'ipc' });

      this.rpc.on('ready', () => {
        this.ready = true;
        log.info('[RPC] Connected');
      });

      try {
        await this.rpc.login({ clientId: this.clientId });
        return;
      } catch (err) {
        log.warn(`[RPC] Login attempt ${i + 1} failed: ${err.message}`);
        try { this.rpc.destroy(); } catch {}
        this.rpc = null;
        this.ready = false;
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    log.error('[RPC] Failed to connect after retries');
  }

  fmt(sec = 0) {
    const s = Math.max(0, Math.floor(sec));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
  }

  async setNowPlaying(track, artist, currentTimeSec = 0, durationSec = 0, paused = false, album = '') {
    if (!this.rpc || !this.ready || !track) return;

    const safeTrack = String(track).trim().slice(0, 128);
    const safeArtist = String(artist || 'YouTube Music').trim();
    const safeAlbum = String(album || '').trim();
    const safeCurrent = Math.max(0, Number(currentTimeSec) || 0);
    const safeDuration = Math.max(0, Number(durationSec) || 0);
    const now = Math.floor(Date.now() / 1000);

    const timeText = safeDuration > 0
      ? `${this.fmt(safeCurrent)}/${this.fmt(safeDuration)}`
      : `${this.fmt(safeCurrent)}/--:--`;

const phase = Math.floor(Date.now() / 10000) % 2;
const phaseMarker = phase === 0 ? '•' : '◦'; // forces distinct text payload

let secondary;
if (paused) {
  secondary = `⏸ Paused at ${timeText}`;
} else if (phase === 0 || !safeAlbum) {
  secondary = timeText;
} else {
  secondary = safeAlbum;
}

const state = `${safeArtist} ${phaseMarker} ${secondary}`.slice(0, 128);

    const activity = {
      type: 2,
      details: `${safeTrack} • ${secondary}`.slice(0, 128),
      state: safeArtist,
      largeImageKey: 'ytmusic',
      largeImageText: 'YouTube Music',
      smallImageKey: paused ? 'pause' : 'music',
      smallImageText: paused ? 'Paused' : 'Listening',
      instance: false
    };

    // Only timestamps while playing
    if (!paused) {
      activity.startTimestamp = now - Math.floor(safeCurrent);
      if (safeDuration > 0) {
        activity.endTimestamp = activity.startTimestamp + Math.floor(safeDuration);
      }
    }

    try {
      await this.rpc.setActivity(activity);
      log.info('[RPC] setActivity ok', {
        track: safeTrack,
        paused,
        phase,
        state: activity.state
      });
    } catch (err) {
      log.error('[RPC] setActivity failed:', err.message);
    }
  }

  async clear() {
    if (!this.rpc || !this.ready) return;
    try {
      await this.rpc.clearActivity();
    } catch {}
  }

  async destroy() {
    if (!this.rpc) return;
    try {
      await this.rpc.destroy();
    } catch {}
    this.rpc = null;
    this.ready = false;
  }
}

module.exports = { DiscordPresence };
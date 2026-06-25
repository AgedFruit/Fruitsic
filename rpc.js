const RPC = require('@xhayper/discord-rpc');
const log = require('electron-log');

class DiscordPresence {
  constructor(clientId) {
    this.clientId = String(clientId || '').trim();
    this.client = null;
    this.ready = false;
    this.connecting = false;
    this.destroyed = false;

    this.displayPreset = this.resolvePreset(process.env.RPC_DISPLAY_PRESET);
  }

  resolvePreset(value) {
    const v = String(value || '').trim().toLowerCase();
    if (v === 'clean' || v === 'time-first' || v === 'album-first') return v;
    return 'clean';
  }

  setDisplayPreset(preset) {
    const next = this.resolvePreset(preset);
    this.displayPreset = next;
    log.info('[RPC] display preset set', { preset: next });
    return this.displayPreset;
  }

  getDisplayPreset() {
    return this.displayPreset;
  }

  fmt(sec = 0) {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
  }

  trim128(text) {
    return String(text || '').trim().slice(0, 128);
  }

  buildStrings({ preset, track, artist, album, timeText, paused }) {
    const safeTrack = this.trim128(track || 'Unknown Track');
    const safeArtist = this.trim128(artist || 'YouTube Music');
    const safeAlbum = this.trim128(album || 'Unknown Album');

    if (paused) {
      return {
        details: safeTrack,
        state: this.trim128(`${safeArtist} • ⏸ Paused at ${timeText}`),
        largeText: this.trim128(`${safeAlbum} • ${timeText}`)
      };
    }

    if (preset === 'time-first') {
      return {
        details: safeTrack,
        state: this.trim128(`${safeArtist} • ${timeText}`),
        largeText: this.trim128(safeAlbum)
      };
    }

    if (preset === 'album-first') {
      return {
        details: this.trim128(`${safeTrack} — ${safeAlbum}`),
        state: safeArtist,
        largeText: this.trim128(timeText)
      };
    }

    // clean
    return {
      details: safeTrack,
      state: this.trim128(`${safeArtist} • ${safeAlbum}`),
      largeText: this.trim128(timeText)
    };
  }

  async connect(retries = 8) {
    if (!this.clientId) {
      log.warn('[RPC] Missing clientId');
      return;
    }

    if (this.connecting || this.ready) return;
    this.connecting = true;
    this.destroyed = false;

    for (let i = 0; i < retries; i++) {
      try {
        this.client = new RPC.Client({ clientId: this.clientId });

        this.client.on('ready', () => {
          this.ready = true;
          log.info('[RPC] Connected', { preset: this.displayPreset });
        });

        this.client.on('disconnected', () => {
          this.ready = false;
          log.warn('[RPC] Disconnected');
        });

        await this.client.login();
        this.connecting = false;
        return;
      } catch (err) {
        this.ready = false;
        log.warn(`[RPC] Login attempt ${i + 1} failed: ${err?.message || err}`);

        try {
          if (this.client?.transport) this.client.transport.close();
        } catch (_) {}

        this.client = null;

        if (i < retries - 1) await new Promise((r) => setTimeout(r, 2000));
      }
    }

    this.connecting = false;
    log.error('[RPC] Failed to connect after retries');
  }

  async setNowPlaying(track, artist, currentTimeSec = 0, durationSec = 0, paused = false, album = '', trackUrl) {
    if (this.destroyed) return;
    if (!this.client || !this.ready || !this.client.user) return;

    const safeTrack = this.trim128(track);
    if (!safeTrack) return;

    const safeArtist = this.trim128(artist || 'YouTube Music');
    const safeAlbum = this.trim128(album || 'Unknown Album');

    const safeCurrent = Math.max(0, Math.floor(Number(currentTimeSec) || 0));
    const safeDuration = Math.max(0, Math.floor(Number(durationSec) || 0));

    const timeText =
      safeDuration > 0
        ? `${this.fmt(safeCurrent)} / ${this.fmt(safeDuration)}`
        : `${this.fmt(safeCurrent)} / --:--`;

    const { details, state, largeText } = this.buildStrings({
      preset: this.displayPreset,
      track: safeTrack,
      artist: safeArtist,
      album: safeAlbum,
      timeText,
      paused: !!paused
    });

    const activity = {
      type: 2, // Listening
      details,
      state,
      largeImageKey: "pineapple",
      largeImageText: "YouTube Music",
      smallImageKey: "ytmusic",
      smallImageText: "YouTube Music",
      instance: false
    };

    if (!paused) {
      const now = Math.floor(Date.now() / 1000);
      const start = now - safeCurrent;
      activity.startTimestamp = start;
      if (safeDuration > 0) activity.endTimestamp = start + safeDuration;
    }

    try {
      await this.client.user.setActivity(activity);
    } catch (err) {
      log.error('[RPC] setActivity failed:', err?.message || err);

      if (!this.connecting) {
        this.ready = false;
        setTimeout(() => {
          this.connect().catch((e) => log.warn('[RPC] reconnect failed', e?.message || e));
        }, 1500);
      }
    }
  }

  async clear() {
    if (!this.client || !this.ready || !this.client.user) return;
    try {
      await this.client.user.clearActivity();
    } catch (err) {
      log.warn('[RPC] clear failed:', err?.message || err);
    }
  }

  async destroy() {
    this.destroyed = true;
    this.connecting = false;

    try {
      if (this.client?.user && this.ready) await this.client.user.clearActivity();
    } catch (_) {}

    try {
      if (this.client?.transport) this.client.transport.close();
    } catch (_) {}

    this.client = null;
    this.ready = false;
  }
}

module.exports = { DiscordPresence };
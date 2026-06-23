const RPC = require('discord-rpc');
const log = require('electron-log');

class DiscordPresence {
  constructor(clientId) {
    this.clientId = clientId;
    this.rpc = null;
    this.ready = false;
    this.lastKey = '';
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

async setNowPlaying(track, artist, currentTimeSec = 0, durationSec = 0, paused = false) {
  if (!this.rpc || !this.ready || !track) return;

  const safeCurrent = Math.max(0, Number(currentTimeSec) || 0);
  const safeDuration = Math.max(0, Number(durationSec) || 0);
  const now = Math.floor(Date.now() / 1000);

  const timeText = safeDuration > 0
    ? `${this.fmt(safeCurrent)}/${this.fmt(safeDuration)}`
    : `${this.fmt(safeCurrent)}/--:--`;

  const stateBase = artist || 'YouTube Music';
  const state = paused
    ? `⏸ Paused at ${timeText} • ${stateBase}`
    : `${stateBase} • ${timeText}`;

  // Single dedupe block (15s cadence)
  const bucket = Math.floor(safeCurrent / 15);
  const dedupeKey = `${track}::${artist}::${paused}::${bucket}`;
  if (dedupeKey === this.lastKey) return;
  this.lastKey = dedupeKey;

  const activity = {
    details: track,
    state,
    largeImageKey: 'ytmusic',
    largeImageText: 'YouTube Music',
    instance: false
  };

  if (!paused) {
    activity.startTimestamp = now - safeCurrent;
    if (safeDuration > 0) {
      activity.endTimestamp = activity.startTimestamp + safeDuration;
    }
  }

  try {
    log.info('[RPC activity]', {
      track,
      artist,
      paused,
      safeCurrent,
      safeDuration,
      startTimestamp: activity.startTimestamp,
      endTimestamp: activity.endTimestamp,
      state: activity.state
    });
    await this.rpc.setActivity(activity);
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
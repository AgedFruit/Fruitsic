const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

const DEFAULT_SETTINGS = {
  discordEnabled: true,
  pollMs: 5000,
  discordClientId: ''
};

function readSettings() {
  const p = getSettingsPath();
  try {
    if (!fs.existsSync(p)) {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, JSON.stringify(DEFAULT_SETTINGS, null, 2), 'utf8');
      return { ...DEFAULT_SETTINGS };
    }

    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw);

    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      pollMs: Math.max(2000, Number(parsed.pollMs ?? DEFAULT_SETTINGS.pollMs))
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function writeSettings(next) {
  const p = getSettingsPath();
  const merged = {
    ...DEFAULT_SETTINGS,
    ...next,
    pollMs: Math.max(2000, Number(next.pollMs ?? DEFAULT_SETTINGS.pollMs))
  };

  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

module.exports = { readSettings, writeSettings, getSettingsPath };
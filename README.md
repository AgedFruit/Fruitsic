# 🍍 Fruitsic

A desktop **YouTube Music** wrapper with:

- **Discord Rich Presence** (track, artist, elapsed time)
- **Mini Player** (frameless, draggable, always-on-top)
- Live **album art** in mini mode
- Local settings API (Express)
- Global hotkey to toggle mini player

---

## How to Use

1. Install Fruitsic with the installer
2. Authorise the Discord app
3. Launch Fruitsic and listen to music

---

## Install Discord App

If Rich Presence doesn’t appear immediately, install/authorise the Fruitsic Discord app once:

**https://discord.com/oauth2/authorize?client_id=1445465237359693877**

Then:

1. Restart Discord
2. Restart Fruitsic
3. Play a track in YouTube Music

---

## Zero-Config by Default

Fruitsic ships with a built-in Discord Application Client ID fallback, so most users can:

1. Install
2. Launch
3. Play music
4. See Rich Presence in Discord

No manual configuration required for normal use.

---

## Troubleshooting

### Presence not connecting
- Ensure Discord desktop is open
- Verify `discordEnabled: true`
- Verify `discordClientId` is set and valid
- Check logs from `electron-log`

### Mini player shows no updates
- Ensure preload exposes:
  - `miniAPI.getNowPlaying()`
  - `miniAPI.onNowPlaying(...)`
  - `miniAPI.toggle()`

### App launches but no controls visible
- Use global hotkey: `Ctrl/Cmd + Shift + M`

---

## Controls

![Mini player example](/assets/mini_player_example.png)

- **Toggle mini player:** `Ctrl+Shift+M` (Windows/Linux) / `Cmd+Shift+M` (macOS)
- Mini player window is draggable (frameless mode)

---

## Features

- Real-time now-playing detection from YouTube Music
- Smart presence update throttling (track changes, seek, pause/play, heartbeat)
- Frameless mini player you can drag anywhere
- Optional local HTTP endpoints for status/settings
- Packaged builds via `electron-builder` (Windows/macOS/Linux)

---

## Mini Player

- Always on top
- Drag anywhere by grabbing the window
- Close with `×`
- Displays:
  - Album art
  - Track title
  - Artist
  - Current time / duration
  - Pause indicator

---

## Stack

- [Electron](https://www.electronjs.org/)
- [discord-rpc](https://www.npmjs.com/package/discord-rpc)
- [Express](https://expressjs.com/)
- [electron-log](https://www.npmjs.com/package/electron-log)

---

## Getting Started – For Development

### 1) Clone and install

```bash
git clone https://github.com/<your-username>/fruitsic.git
cd fruitsic
npm install
```

### 2) Configure Discord Client ID

You can use either:

- `settings.json` (preferred)
- `.env` fallback in development

#### Option A: settings.json (preferred)

Fruitsic stores settings in Electron `userData`:

- **Windows:** `%APPDATA%/Fruitsic/settings.json`
- **macOS:** `~/Library/Application Support/Fruitsic/settings.json`
- **Linux:** `~/.config/Fruitsic/settings.json`

Example:

```json
{
  "discordEnabled": true,
  "pollMs": 5000,
  "discordClientId": "DISCORD_APP_CLIENT_ID"
}
```

#### Option B: `.env` (development fallback)

Create `.env` in project root:

```env
DISCORD_CLIENT_ID=DISCORD_APP_CLIENT_ID
EXPRESS_PORT=3977
```

> In development, if `settings.discordClientId` is empty, Fruitsic can fall back to `.env`.

---

## 🧪 Run in Development

```bash
npm run start
```

or

```bash
npm run dev
```

Open Discord desktop and play a song in YouTube Music.

---

## Local API (Express)

Default: `http://localhost:3977`

### `GET /status`
Returns now-playing and app status.

### `GET /settings`
Returns current settings.

### `POST /settings`
Updates settings.

Example:

```bash
curl -X POST http://localhost:3977/settings \
  -H "Content-Type: application/json" \
  -d "{\"discordClientId\":\"123456789012345678\",\"discordEnabled\":true}"
```

---

## Build / Package

```bash
npm run dist
```

Platform-specific:

```bash
npm run dist:win
npm run dist:mac
npm run dist:linux
```

Build output goes to `dist/`.

---

## Licence

MIT – do whatever, just keep attribution.

---

## Credits

Built with Electron + Discord RPC + caffeine.
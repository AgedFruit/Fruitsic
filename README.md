# 🍍 Fruitsic

A desktop **YouTube Music** wrapper with:

- **Discord Rich Presence** (track, artist, elapsed time)
- **Mini Player** (frameless, draggable, always-on-top)
- Live **album art** in mini mode
- Local settings API (Express)
- Global hotkey to toggle mini player

---

## Features

- Real-time now-playing detection from YouTube Music
- Smart presence update throttling (track changes, seek, pause/play, heartbeat)
- Frameless mini player you can drag anywhere
- Optional local HTTP endpoints for status/settings
- Packaged builds via `electron-builder` (Windows/macOS/Linux)

---

## 📸 Mini Player

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

## Getting Started

### 1) Clone + install

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
  "discordClientId": "YOUR_DISCORD_APP_CLIENT_ID"
}
```

#### Option B: `.env` (dev fallback)

Create `.env` in project root:

```env
DISCORD_CLIENT_ID=YOUR_DISCORD_APP_CLIENT_ID
EXPRESS_PORT=3977
```

> In dev, if `settings.discordClientId` is empty, Fruitsic can fall back to `.env`.

---

## 🧪 Run in Development

```bash
npm run start
```

or

```bash
npm run dev
```

Open Discord desktop + play a song in YouTube Music.

---

## Controls

- **Toggle mini player:** `Ctrl+Shift+M` (Windows/Linux) / `Cmd+Shift+M` (macOS)
- Mini player window is draggable (frameless mode)

---

## Local API (Express)

Default: `http://localhost:3977`

### `GET /status`
Returns now-playing + app status.

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

## 📄 License

MIT — do whatever, just keep attribution.

---

## 🙌 Credits

Built with Electron + Discord RPC + caffeine.

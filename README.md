# 🍍 Fruitsic

A desktop **YouTube Music** wrapper with:

- **Discord Rich Presence** (track, artist, album/time presets, elapsed/progress)
- **Mini Player** (frameless, draggable, always-on-top)
- Live **album art** in mini mode
- Local settings API (Express)
- Global hotkey to toggle mini player

---

## How to Use

1. Install Fruitsic with the installer
2. Authorize the Discord app (first run)
3. Launch Fruitsic and play music on YouTube Music

---

## Install / Authorize Discord App

If Rich Presence does not appear immediately, authorize the Fruitsic Discord app once:

**https://discord.com/oauth2/authorize?client_id=1445465237359693877**

Then:

1. Fully restart Discord desktop
2. Restart Fruitsic
3. Play a track in YouTube Music

---

## Zero-Config by Default

Fruitsic ships with a built-in Discord Application Client ID fallback, so most users can:

1. Install
2. Launch
3. Play music
4. See Rich Presence in Discord

No manual setup is required for normal use (probably).

---

## Features

- Real-time now-playing detection from YouTube Music
- Smart presence update throttling (track changes, seek, pause/play, heartbeat)
- Rich Presence display presets:
  - `clean`
  - `time-first`
  - `album-first`
- Frameless mini player you can drag anywhere
- Optional local HTTP endpoints for status/settings
- Packaged builds via `electron-builder` (Windows/macOS/Linux)

---

## Controls

![Mini player example](/assets/mini_player_example.png)

- **Toggle mini player:** `Ctrl+Shift+M` (Windows/Linux) / `Cmd+Shift+M` (macOS)
- Mini player window is draggable (frameless mode)
- Close mini player with `×`

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

## Troubleshooting

### Presence not connecting

- Ensure Discord desktop is open
- Ensure `discordEnabled: true`
- Ensure `discordClientId` is set and valid
- Check `electron-log` output

### Presence connected but image assets do not show

- Verify asset keys exist in your Discord application
- Confirm the app is using the expected Discord application/client ID
- Fully quit Discord from tray and reopen

### Mini player shows no updates

Ensure preload exposes:

- `miniAPI.getNowPlaying()`
- `miniAPI.onNowPlaying(...)`
- `miniAPI.toggle()`

### App launches but no controls visible

Use the global hotkey:

- `Ctrl/Cmd + Shift + M`

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
  -d "{\"discordClientId\":\"123456789012345678\",\"discordEnabled\":true,\"rpcDisplayPreset\":\"clean\"}"
```

---

## Settings

Fruitsic stores settings in Electron `userData`:

- **Windows:** `%APPDATA%/Fruitsic/settings.json`
- **macOS:** `~/Library/Application Support/Fruitsic/settings.json`
- **Linux:** `~/.config/Fruitsic/settings.json`

Example:

```json
{
  "discordEnabled": true,
  "pollMs": 5000,
  "discordClientId": "DISCORD_APP_CLIENT_ID",
  "rpcDisplayPreset": "clean"
}
```

---

## Stack

- [Electron](https://www.electronjs.org/)
- [@xhayper/discord-rpc](https://www.npmjs.com/package/@xhayper/discord-rpc)
- [Express](https://expressjs.com/)
- [electron-log](https://www.npmjs.com/package/electron-log)

---

## Legal Notice

Fruitsic is an independent, unofficial desktop application.

- Fruitsic is **not affiliated with, endorsed by, or sponsored by** YouTube, Google, or Discord.
- YouTube, YouTube Music, Discord, and related names/logos are trademarks of their respective owners.
- Use of third-party services through Fruitsic is subject to those services’ own terms and privacy policies.
- Fruitsic is provided **“as is”** without warranties of any kind, to the extent permitted by law.

For full details, see:

- [Terms of Service](./TERMS_OF_SERVICE.md)
- [Privacy Policy](./PRIVACY_POLICY.md)

---

## Getting Started (Development)

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

#### Option A: `settings.json` (preferred)

Edit the userData settings file (paths above), then set:

```json
{
  "discordEnabled": true,
  "pollMs": 5000,
  "discordClientId": "DISCORD_APP_CLIENT_ID",
  "rpcDisplayPreset": "clean"
}
```

#### Option B: `.env` (development fallback)

Create `.env` in project root:

```env
DISCORD_CLIENT_ID=DISCORD_APP_CLIENT_ID
EXPRESS_PORT=3977
RPC_DISPLAY_PRESET=clean
```

> In development, if `settings.discordClientId` is empty, Fruitsic can fall back to `.env`.

---

## Run in Development

```bash
npm run start
```

or

```bash
npm run dev
```

Open Discord desktop and play a song in YouTube Music.

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

## License

MIT — do whatever, just keep attribution.

---

## Credits

Built with Electron + Discord RPC + caffeine.
YouTube Music Icon:
[Audio icons created by Enamo Studios - Flaticon](https://www.flaticon.com/free-icons/audio)

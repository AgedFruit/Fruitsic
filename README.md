# 🍍 Fruitsic

Want to show your friends your horrible taste in music but can't because you use YouTube Music?

Look no further than Fruitsic, this **wrapper** for YouTube Music treats YouTube Music as a standalone desktop app like Spotify with built in Discord Rich Text Presence, meaning you can be BM'd in real time.

A desktop **YouTube Music** wrapper with:

- **Discord Rich Presence** (track, artist, album/time presets, elapsed/progress)
- **Mini Player** (frameless, draggable, always-on-top)
- Live **album art** in mini mode
- Local settings API (Express)
- Global hotkey to toggle mini player

---

## Install / Authorise Discord App

Click the below link and add the app to your Discord account.

**https://discord.com/oauth2/authorize?client_id=1445465237359693877**

Then:

1. Download the Fruitsic Installer & run it
2. Fully restart Discord desktop
3. Open Fruitsic / Login to Youtube Music
4. Listen to music

---
## Controls

![Mini player example](/assets/mini_player_example.png)

- **Toggle mini player:** `Ctrl+Shift+M` (Windows/Linux) / `Cmd+Shift+M` (macOS)
- Mini player window is draggable and resizeable (using the top right corner)
- Close mini player with `×`
- Play / Pause / Next / Previous Track / volume control
- Mini Player activates when the program is minimised

---
## Features

- Real-time now-playing detection from YouTube Music
- Smart presence update throttling (track changes, seek, pause/play, heartbeat)
- Rich Presence display presets (clean is best / default):
  - `clean`
  - `time-first`
  - `album-first`
- Frameless mini player you can drag anywhere
- Optional local HTTP endpoints for status/settings
- Packaged builds via `electron-builder` (Windows/macOS/Linux)
- Times out after a song has been paused for 60 seconds

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

## License

MIT — do whatever, just keep attribution.

---

## Credits

Built with Electron + Discord RPC + caffeine.  

[Icon By Hiccup](https://x.com/Never_Hiccups)  
[Pineapple Icon by Freepik](https://www.flaticon.com/free-icon/pineapple_8692265?term=pineapple&page=1&position=3&origin=search&related_id=8692265)  
[Youtube Music Icon](https://www.flaticon.com/free-icon/music_15047447?term=youtube+music&page=1&position=3&origin=search&related_id=15047447)

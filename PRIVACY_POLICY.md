# Privacy Policy – Fruitsic

**Last updated:** 24 June 2026

This Privacy Policy explains how **Fruitsic** (“Fruitsic”, “the App”, “we”, “us”, “our”) handles information when you use the App.

---

## 1. Overview

Fruitsic is designed to run locally on your device.  
We aim to minimise data collection and keep core functionality local.

---

## 2. Information We Process

Depending on how you use the App, Fruitsic may process:

### a) Playback Information (local runtime data)
- Track title
- Artist name
- Playback position and duration
- Playback state (playing/paused)
- Album art URL or artwork metadata (for display features)

This data is used to power app UI features and optional Discord Rich Presence.

### b) Local Settings
Fruitsic stores settings on your device (for example):
- `discordEnabled`
- `discordClientId`
- polling/configuration values

Typical path examples:
- Windows: `%APPDATA%/Fruitsic/settings.json`
- macOS: `~/Library/Application Support/Fruitsic/settings.json`
- Linux: `~/.config/Fruitsic/settings.json`

### c) Local Logs
If enabled by app behaviour/dependencies, local diagnostic logs may be written on your device (for troubleshooting).

---

## 3. How Information Is Used

We use processed information to:

- Display now-playing information in the app
- Update optional Discord Rich Presence
- Save local preferences/settings
- Troubleshoot reliability issues via local logs

---

## 4. What We Do Not Do

Fruitsic does **not** operate a central account system or cloud backend for collecting your personal profile data.

We do **not** sell your personal data.

---

## 5. Third-Party Services

Fruitsic integrates with third-party services, including YouTube Music and Discord.  
When interacting with those services, their own privacy policies and terms apply.

Please review:
- Google/YouTube policies
- Discord privacy policy

We are not responsible for third-party privacy practices.

---

## 6. Local API Exposure

Fruitsic may run a local HTTP server (for example, `http://localhost:3977`) for local status/settings access.

- It is intended for use on your own machine.
- You are responsible for local device/network security.
- Do not expose local ports publicly unless you understand the security implications.

---

## 7. Data Retention

Because Fruitsic is primarily local-first:

- Local settings remain until you edit or remove them
- Local logs remain until rotated/deleted by app or user
- Uninstalling the app may not automatically remove all local files; you can delete remaining settings/log files manually

---

## 8. Security

We take reasonable steps to reduce risk in the app design, but no software can guarantee absolute security.

You are responsible for securing your device, user account, and local environment.

---

## 9. Children’s Privacy

Fruitsic is not specifically directed to children.  
If you are a parent or guardian and believe inappropriate personal data has been processed, contact us to review removal options.

---

## 10. International Use

If you use Fruitsic outside your home country, local laws may apply to your use of third-party services.

---

## 11. Changes to This Policy

We may update this Privacy Policy from time to time.  
We will update the “Last updated” date when changes are made.

---

## 12. Contact

For privacy questions:

- **Project:** Fruitsic
- **GitHub:** https://github.com/agedfruit/fruitsic
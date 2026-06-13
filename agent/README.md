# cutshort-agent

The desktop half of [CutShort](../README.md). It receives shortcut combos from
your phone over WebSocket (LAN or Cloudflare tunnel) and injects them as **real
OS keystrokes** via [nut.js](https://nutjs.dev) — works on macOS, Windows, Linux.

## Run it

```bash
# from a published build
npx cutshort-agent

# or from this repo (after `npm run build` in the project root so ../dist exists)
cd agent && npm install && npm start
```

On boot it:

1. Serves the built phone app from `../dist` (so scanning the QR opens a working,
   already-paired deck — no Vercel needed).
2. Opens a WebSocket server on `:8787` (override with `CUTSHORT_PORT`).
3. Prints **two QR codes** in the terminal: one for the LAN URL (same WiFi) and
   one for the Cloudflare tunnel URL (reachable anywhere). Scan either.

```
🛜  LAN (same WiFi):  http://192.168.x.x:8787/
✅  cloudflared:  https://something.trycloudflare.com/
```

## Permissions

Injecting keystrokes needs OS-level accessibility access — grant it once:

- **macOS:** System Settings → Privacy & Security → **Accessibility** → enable
  your terminal (or the packaged app). The first keystroke triggers the prompt.
- **Windows:** runs as-is; run elevated only if you target an elevated app.
- **Linux:** X11 works out of the box; Wayland needs `ydotool`/uinput.

## Tunnel

Cloudflare Quick Tunnel is the default (free, no account, supports WebSockets),
with ngrok as a fallback. Install one for remote access:

```bash
brew install cloudflared                  # macOS
winget install cloudflare.cloudflared     # Windows
```

Without a tunnel binary the agent still serves the LAN URL on the same WiFi.

## Protocol

JSON over WebSocket at `/ws` (see [`src/index.js`](src/index.js)):

```
client → { v:1, t:"key",  d:{ mods:[...], key, os } }   // mods: MOD|SUPER|SHIFT|ALT|CTRL
client → { v:1, t:"ping" }
server → { v:1, t:"hello", d:{ host, os, version } }
server → { v:1, t:"ack",   d:{ combo } } | { t:"pong" } | { t:"error", d:{ message } }
```

`MOD`/`SUPER` resolve against **this machine's** platform (⌘ on macOS, Ctrl/Win
on Windows), so the agent — not the phone — is the source of truth for modifiers.

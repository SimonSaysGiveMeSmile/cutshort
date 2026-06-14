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
3. Shows **two QR codes** — one for the LAN URL (same WiFi) and one for the
   Cloudflare tunnel URL (reachable anywhere). Scan either.

```
🛜  LAN (same WiFi):  http://192.168.x.x:8787/
✅  cloudflared:  https://something.trycloudflare.com/
```

### macOS: runs as a "CutShort" app

On macOS the agent relaunches itself through a generated
`~/Applications/CutShort.app` so the **Accessibility permission is attributed to
a dedicated “CutShort” row** instead of a generic “Node” (or your whole
terminal). Because that detaches it from the terminal, the QR codes open on a
**pairing page in your browser** (with a *Stop agent* button) rather than
printing inline.

```bash
cutshort-agent              # → launches CutShort.app, opens the pairing page
cutshort-agent --stop       # stop the backgrounded agent
CUTSHORT_NO_APP=1 cutshort-agent   # opt out: stay in the terminal, QR inline
CUTSHORT_NO_OPEN=1 ...             # don't open the browser/Settings (headless)
```

The bundle is ad-hoc code-signed and rebuilt automatically whenever your Node
binary changes. With only ad-hoc signing the Accessibility grant resets after a
Node upgrade (re-toggle the row once); a Developer ID signature would make it
persist. On Windows/Linux none of this applies — the agent just runs.

## Permissions

Injecting keystrokes needs OS-level accessibility access — grant it once:

- **macOS:** System Settings → Privacy & Security → **Accessibility** → enable
  the **CutShort** row (the agent runs as `CutShort.app` — see above). The first
  keystroke triggers the prompt; after enabling, restart the agent so the grant
  takes effect. (With `CUTSHORT_NO_APP=1` you instead enable your terminal/IDE.)
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

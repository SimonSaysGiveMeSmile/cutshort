# CutShort

**A pocket shortcut deck for your dev machine.** Open the web app on your phone,
scan the QR your desktop agent shows, and every key you tap — Copy, Paste, Select
All, Hard Reload, Clear Cache, Command Palette — fires on your Mac or Windows
machine. Like a Stream Deck, but it's just a web page, and it understands
keyboard shortcuts instead of macros.

Open source (GPL-3.0). Mobile-first. Ten swappable skins.

---

## Why

When you're heads-down coding you reach for the same dozen combos all day. CutShort
puts them under your thumb on a second screen, with the right modifier for the OS
you're driving (⌘ on macOS, Ctrl on Windows) chosen automatically.

## How it connects (mirrors Son of Anton's pairing model)

```
  Phone (this web app)                    Desktop agent (cutshort-agent)
  ────────────────────                    ──────────────────────────────
  │  Shortcut deck   │  ── key frame ──►  │  WS server  ──►  key injector │
  │  10 themes       │   {mods,key,os}    │  (nut.js / robotjs)           │
  │  Mac/Win switch  │  ◄── hello/ack ──  │  Cloudflare Quick Tunnel + QR │
  ────────────────────                    ──────────────────────────────
```

1. **Desktop agent** (separate package, `cutshort-agent`) runs a tiny WS server,
   injects OS keystrokes via [nut.js](https://nutjs.dev) (cross-platform), and
   brings up a Cloudflare Quick Tunnel so the phone can reach it from anywhere —
   exactly the pattern `soa-web` uses for PTYs. It prints a QR with the pairing
   URL + single-use token.
2. **Phone** opens `cutshort.online`, scans the QR, and connects. The deck sends
   `{ v:1, t:"key", d:{ mods, key, os } }` frames; the agent replays them as real
   key events.

### Transport is pluggable — to be decided by test results

`src/lib/connection.ts` defines one `Transport` interface with three backends, so
we can A/B latency before committing:

| Transport   | Path                                  | Status   |
| ----------- | ------------------------------------- | -------- |
| `lan`       | WebSocket over local WiFi (`*.local`) | primary  |
| `tunnel`    | WebSocket over Cloudflare tunnel      | fallback |
| `bluetooth` | Web Bluetooth GATT write (offline)    | supplementary |
| `demo`      | logs frames, no backend               | dev/try-it |

`Connection.pair()` tries WS and silently falls back to demo mode, so the UI is
always usable — open it right now with **Try demo** on the connect screen.

## The 10 skins

Each is a `data-theme` swap on `<html>` — CSS variables plus a few decorative
rules in `src/index.css`. No JS rerender, no asset reload.

1. **Liquid Glass** — Apple visionOS frost, drifting gradient, backdrop blur
2. **Sandblasted Stardust** — grainy frosted glass over a twinkling cosmic field
3. **Siri Gradient** — a living conic mesh, like the Siri orb
4. **Neon Grid** — TRON dark with a perspective grid floor and cyan/magenta glow
5. **Maxcolor** — maximalist color blocks, fat borders, hard offset shadows
6. **Minimalist** — paper-white, hairline rules, restrained
7. **Clay Soft** — puffy pastel claymorphism, neumorphic shadows
8. **Aurora** — northern-lights gradients drifting on near-black
9. **Brutalist** — raw Space Mono, zero rounding, yellow accent
10. **Terminal** — phosphor-green CRT with scanlines and a blinking cursor

Tap **✦ Skin** in the top bar to switch; the choice persists to `localStorage`.

## Customizing shortcuts (roadmap)

- **Now:** the deck is data-driven from `src/shortcuts.ts` — add/edit entries
  there. `MOD` resolves to ⌘/Ctrl; use explicit `mac`/`win` overrides for combos
  that genuinely diverge (Redo, DevTools, Screenshot, Quit…).
- **Next (desktop web build):** an **embedded agent** that lets you describe a
  shortcut in natural language and it wires up the combo by composing the
  **existing components** (`ShortcutButton`, the combo model) rather than
  generating new UI on the fly. The agent edits the `Shortcut[]` data, not the
  render tree.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173 (open on your phone via LAN IP)
npm run build      # type-check + production build to dist/
npm run preview    # serve the build
```

Stack: **React + TypeScript + Tailwind v4 + Vite**. Mobile-first; PWA meta in
`index.html`.

## Deploy (Vercel — Hireal team scope)

This deploys to the **Hireal** Vercel team, not a personal account:

```bash
npm i -g vercel
vercel login                       # use the Hireal-associated login
vercel link --scope hireal         # link to the Hireal team project
vercel --prod                       # ship
```

`vercel.json` pins the Vite framework preset and SPA rewrites. Point the
`cutshort.online` domain at the project in the Hireal team's dashboard.

> Note: Vercel hosts the **static phone app** only. The desktop agent (WS +
> tunnel) is a separate process that runs on the user's machine — serverless
> functions can't hold the long-lived WebSocket, same constraint `soa-web`
> documents.

## Layout

```
src/
  shortcuts.ts            shortcut data model + OS combo resolution
  themes.ts               10-theme registry + persistence
  index.css               base layer + all 10 themes
  lib/connection.ts       pluggable transport (lan/tunnel/bluetooth/demo)
  components/
    ConnectScreen.tsx     QR pairing + manual URL + demo entry
    ControllerScreen.tsx  top bar, OS switch, categories, the deck
    ShortcutButton.tsx    a single key (ripple + haptic)
    ThemeSheet.tsx        skin picker bottom sheet
```

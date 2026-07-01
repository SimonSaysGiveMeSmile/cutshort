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
  │  10 themes       │   {mods,key,os}    │  (nut.js keystroke)           │
  │  Mac/Win switch  │  ◄── hello/ack ──  │  Cloudflare Quick Tunnel + QR │
  ────────────────────                    ──────────────────────────────
```

1. **Desktop agent** ([`agent/`](agent/), package `cutshort-agent`) runs a WS
   server, serves the built phone app, injects OS keystrokes via
   [nut.js](https://nutjs.dev) (cross-platform), and brings up a Cloudflare Quick
   Tunnel so the phone can reach it from anywhere — the pattern `soa-web` uses
   for PTYs. It prints a QR of the connect URL. Start it with `npx cutshort-agent`.
2. **Phone** scans that QR. Because the QR opens the app already pointed at the
   agent (same-origin over the tunnel, or via a `#connect=` param on the hosted
   app), it **auto-connects** — no demo, no manual step. The deck then sends
   `{ v:1, t:"key", d:{ mods, key, os } }` frames and the agent replays them as
   real key events. You can also paste the agent's `ws://…` URL manually.

### Pairing is token-gated

Every agent run mints a fresh 128-bit pairing token. It rides **only** in the QR /
pairing URL fragment (`#t=…`) — never served from an endpoint over the LAN or tunnel
— and is required on the WebSocket upgrade (and the control POSTs), so learning the
public tunnel URL alone can't inject keystrokes into your session. The token-bearing
pairing page and the quit / accessibility controls live on a **separate loopback-only
listener** (`127.0.0.1`) the tunnel physically can't reach; the public `0.0.0.0`
listener serves only the SPA and the token-gated `/ws`.

### Transport is pluggable — and latency-measured

`src/lib/connection.ts` defines one `Transport` interface so we can A/B latency
between pipes:

| Transport   | Path                                  | Status        |
| ----------- | ------------------------------------- | ------------- |
| `lan`       | WebSocket over local WiFi (`*.local`) | primary       |
| `tunnel`    | WebSocket over Cloudflare tunnel      | fallback      |
| `bluetooth` | Web Bluetooth GATT write + notify     | supplementary |

`detectAgent()` auto-resolves the endpoint from the scanned QR / serving origin;
`Connection.pair()` opens the socket and surfaces a real error if the agent
isn't reachable (no silent demo mode).

The A/B is real, not aspirational: every transport's heartbeat ping/pong is timed
into a round-trip sample (`src/lib/latency.ts`), so the top bar shows the live
median RTT (e.g. `DevBox · 24ms`) and `Connection.fastestTransport()` ranks the
sampled pipes by median (ties break toward the preference order above rather than
sub-5ms noise). LAN and tunnel are sampled today off the existing keepalive;
Bluetooth is now a two-way link — it decodes GATT notifications back into
`hello`/`ack`/`error` frames — and joins the RTT A/B once an agent-side BLE
peripheral answers its pings.

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

Tap the **palette** icon in the top bar to switch skins, and the **sun/moon**
icon to flip light/dark — every skin ships both modes. Both persist to
`localStorage`.

## Customizing shortcuts (roadmap)

- **In the app now:** tap the **sliders** icon to open the deck editor — add
  your own shortcuts (label + icon from the Lucide palette + modifier chips +
  key, with a live combo preview), hide built-ins you don't use, and restore
  them later. Custom shortcuts + hidden built-ins persist to `localStorage`
  (`src/lib/shortcutStore.ts`). `MOD` resolves to ⌘/Ctrl, `SUPER` to ⌘/Win.
- **Describe it in words:** the editor's "Describe it" box turns a phrase like
  *"toggle sidebar cmd b"* or *"⌘⇧P command palette"* into the pre-filled combo
  fields (`src/lib/nlShortcut.ts`) — modifiers as words/glyphs/`+`-joins, `ctrl`
  resolved per-OS, named keys normalized — then the same **Add**/`addCustom()`
  persists it. It composes the existing editor rather than generating new UI.
- **Defaults** live in `src/shortcuts.ts`; the deck renders from the merged
  store, not the static list.
- **Next (LLM path):** let the same box resolve pure *action names* the
  deterministic parser deliberately leaves alone (*"peek definition"* → the right
  combo per OS), still calling `addCustom()` — an enhancement to the parser, not
  a parallel code path.

## Develop

```bash
# phone app
npm install
npm run dev        # http://localhost:5188 (open on your phone via LAN IP)
npm run build      # type-check + production build to dist/

# desktop agent (after the build above, so it can serve ../dist)
cd agent && npm install && npm start    # prints LAN + tunnel QR codes
```

Stack: **React + TypeScript + Tailwind v4 + Vite** (phone) · **Node + ws +
nut.js + qrcode** (agent). Mobile-first; PWA meta in `index.html`. See
[`agent/README.md`](agent/README.md) for accessibility permissions.

## Deploy (Vercel — Hireal team scope)

This deploys to the **Hireal** Vercel team, not a personal account:

```bash
npm i -g vercel
vercel login                       # use the Hireal-associated login
vercel link --scope hireal         # link to the Hireal team project
vercel --prod                       # ship
```

`vercel.json` pins the Vite framework preset, SPA rewrites, and security headers
(deny framing / `nosniff` / `no-referrer`). Point the `cutshort.online` domain at
the project in the Hireal team's dashboard.

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
  lib/connection.ts       pluggable transport (lan/tunnel/bluetooth) + reconnect
  lib/latency.ts          RTT sampling + transport A/B (summarize / pickFastest)
  lib/nlShortcut.ts       natural-language phrase → { mods, key, label } parser
  components/
    ConnectScreen.tsx     agent command + manual URL + Bluetooth
    ControllerScreen.tsx  top bar, OS switch, mode toggle, categories, deck
    ShortcutButton.tsx    a single key (ripple + haptic)
    ThemeSheet.tsx        skin picker bottom sheet
    Icon.tsx              cohesive Lucide icon set (no emoji)

agent/
  src/index.js            token-gated WS server + static host + tunnel + QR
  src/auth.js             per-run pairing token (mint / parse / constant-time match)
  src/keys.js             combo → nut.js keystroke injection
  src/tunnel.js           Cloudflare Quick Tunnel (ngrok fallback)
  src/net.js              LAN IPv4 discovery (physical NICs before virtual)
```

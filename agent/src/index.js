#!/usr/bin/env node
// CutShort desktop agent
// ----------------------
// 1. Serves the built phone app (../dist) so scanning the QR opens a working
//    deck from THIS machine — same-origin, no Vercel needed.
// 2. Upgrades /ws and injects every combo it receives as a real keystroke.
// 3. Opens a Cloudflare Quick Tunnel and prints a QR of the public URL.
//
// On macOS it first relaunches itself through ~/Applications/CutShort.app so the
// Accessibility permission is attributed to a dedicated "CutShort" row instead
// of a generic "Node". In that mode there's no terminal, so the pairing QR is
// shown on a localhost page that opens in the browser. Opt out with
// CUTSHORT_NO_APP=1 to keep the pure-terminal flow.
//
// Wire protocol (matches the web app's src/lib/connection.ts):
//   client -> { v:1, t:"key",  d:{ mods:[...], key, os } }
//          -> { v:1, t:"ping" }
//   server -> { v:1, t:"hello", d:{ host, os, version } }
//          -> { v:1, t:"ack", d:{ combo } } | { v:1, t:"pong" }

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { exec } from "node:child_process";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import QRCode from "qrcode";
import { injectCombo } from "./keys.js";
import { openTunnel } from "./tunnel.js";
import { lanIPv4s } from "./net.js";
import { generateToken, tokenFromUrl, tokensMatch, isLoopback } from "./auth.js";
import { ensureAccessibility, openAccessibilityPane } from "./macAccess.js";
import {
  APP_NAME,
  runningAsApp,
  relaunchViaApp,
  writePid,
  clearPid,
  stopRunning,
} from "./appBundle.js";
import { renderPairPage } from "./pairPage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const THIS_FILE = fileURLToPath(import.meta.url);

const argVal = (flag) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

// `cutshort-agent --stop` kills a backgrounded (app-mode) agent and exits.
if (process.argv.includes("--stop")) {
  const pid = stopRunning();
  console.log(pid ? `Stopped ${APP_NAME} agent (pid ${pid}).` : `No running ${APP_NAME} agent found.`);
  process.exit(0);
}

const AS_APP = runningAsApp();
const PORT = Number(argVal("--port") || process.env.CUTSHORT_PORT || 8787);
// On macOS, default to relaunching via the app bundle (for the named
// Accessibility row). Skip when already in the app, when opted out, or off-mac.
const USE_APP = process.platform === "darwin" && !AS_APP && process.env.CUTSHORT_NO_APP !== "1";

// App mode has no terminal — tee console to a log file for debugging.
if (AS_APP) {
  try {
    const stream = fs.createWriteStream(path.join(os.homedir(), ".cutshort-agent.log"), { flags: "a" });
    const w = (...a) => stream.write(a.map(String).join(" ") + "\n");
    console.log = w;
    console.warn = w;
    console.error = w;
  } catch {
    /* logging is best-effort */
  }
}

// ── relaunch-as-app: become a throwaway launcher, then exit ─────────
if (USE_APP) {
  console.log("┌──────────────────────────────────────────────┐");
  console.log(`│  ${APP_NAME} agent`.padEnd(49) + "│");
  console.log("└──────────────────────────────────────────────┘");
  console.log(`🚀  Launching ${APP_NAME}.app so macOS shows a dedicated “${APP_NAME}”`);
  console.log("    row in Accessibility (instead of a generic “Node”)…");
  const ok = relaunchViaApp(THIS_FILE, ["--port", String(PORT)]);
  if (ok) {
    console.log("\n📲  The pairing QR will open in your browser in a moment.");
    console.log("    You can close this terminal window.");
    console.log(`    • Stop the agent:         ${path.basename(process.argv[1] || "cutshort-agent")} --stop`);
    console.log("    • Prefer the terminal:    CUTSHORT_NO_APP=1 cutshort-agent\n");
    process.exit(0);
  }
  console.log("⚠  Couldn't launch the app bundle — continuing in terminal mode.\n");
}

// Prefer a dist bundled inside the published package; fall back to the repo's
// sibling dist when running from a clone.
const DIST = [
  path.resolve(__dirname, "..", "dist"), // published package: agent/dist
  path.resolve(__dirname, "..", "..", "dist"), // repo dev: <root>/dist
].find((p) => fs.existsSync(path.join(p, "index.html")));
const HAS_APP = !!DIST;
// When the app isn't bundled, point the QR at the hosted deck instead.
const HOSTED_APP = process.env.CUTSHORT_APP || "https://cutshort.online";
const HOSTNAME = os.hostname().replace(/\.local$/, "");
const PLATFORM = process.platform === "darwin" ? "mac" : "win";
const VERSION = "0.1.0";

// Pairing secret. Minted per run, delivered to the phone ONLY via the QR/pairing
// fragment (never served from an endpoint over LAN/tunnel), and required on the
// WebSocket upgrade and the control POSTs. Without it, anyone who learns the
// tunnel URL could inject keystrokes into this desktop session.
const AUTH_TOKEN = generateToken();
const isAuthed = (req) => tokensMatch(tokenFromUrl(req.url), AUTH_TOKEN);

// Mutable runtime state shared with the HTTP handlers.
let PAIR_HTML = null; // rendered once scan targets are known (app mode)
let CURRENT_SHUTDOWN = () => process.exit(0);

// ── static file server (serves the SPA + a few control routes) ─────
const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

function forbidden(res) {
  res.writeHead(403, { "content-type": "application/json" });
  res.end('{"ok":false,"error":"forbidden"}');
}

function serveStatic(req, res) {
  const url = (req.url || "/").split("?")[0];

  if (url === "/health" || url === "/api/ping") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, host: HOSTNAME, os: PLATFORM, version: VERSION }));
    return;
  }
  if (req.method === "POST" && url === "/api/quit") {
    if (!isAuthed(req)) return forbidden(res);
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"ok":true}');
    setTimeout(() => CURRENT_SHUTDOWN(), 150);
    return;
  }
  if (req.method === "POST" && url === "/api/open-accessibility") {
    if (!isAuthed(req)) return forbidden(res);
    openAccessibilityPane();
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"ok":true}');
    return;
  }
  if (url === "/pair") {
    // The pairing page embeds the token (in the QR images and its own control
    // calls), so it must never be served beyond this machine — otherwise the
    // token would leak to anyone who can reach the LAN/tunnel address.
    if (!isLoopback(req.socket.remoteAddress)) return forbidden(res);
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(
      PAIR_HTML ||
        `<!doctype html><meta http-equiv="refresh" content="1"><body style="font-family:system-ui;background:#0a0b0e;color:#9aa3ad;padding:3rem;text-align:center">Starting ${APP_NAME}… this page will refresh.</body>`,
    );
    return;
  }

  if (!HAS_APP) {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("CutShort agent is running. Scan the QR from the terminal/browser to open the deck.");
    return;
  }
  let urlPath = decodeURIComponent(url);
  if (urlPath === "/") urlPath = "/index.html";
  let filePath = path.join(DIST, urlPath);
  // SPA fallback: unknown non-asset routes -> index.html
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST, "index.html");
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, { "content-type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer(serveStatic);

// ── WebSocket: receive combos, inject keystrokes ───────────────────
// Reject the upgrade unless it carries the pairing token, and cap the frame
// size — key frames are tiny, so a large payload is either a bug or an attempt
// to exhaust memory.
const wss = new WebSocketServer({
  server,
  path: "/ws",
  maxPayload: 4096,
  verifyClient: ({ req }) => isAuthed(req),
});

wss.on("connection", (ws, req) => {
  const peer = req.socket.remoteAddress;
  console.log(`📱 phone connected (${peer})`);
  ws.send(JSON.stringify({ v: 1, t: "hello", d: { host: HOSTNAME, os: PLATFORM, version: VERSION } }));

  ws.on("message", async (raw) => {
    let frame;
    try {
      frame = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (frame.t === "ping") {
      ws.send(JSON.stringify({ v: 1, t: "pong" }));
      return;
    }
    if (frame.t === "key" && frame.d) {
      try {
        const fired = await injectCombo(frame.d);
        console.log(`⌨  ${fired}`);
        ws.send(JSON.stringify({ v: 1, t: "ack", d: { combo: fired } }));
      } catch (e) {
        console.warn(`✗  ${e.message}`);
        ws.send(JSON.stringify({ v: 1, t: "error", d: { message: e.message } }));
      }
    }
  });

  ws.on("close", () => console.log("📴 phone disconnected"));
});

// ── boot ───────────────────────────────────────────────────────────
async function printQR(url, label) {
  const qr = await QRCode.toString(url, { type: "terminal", small: true });
  console.log(`\n${label}\n${qr}`);
}

server.listen(PORT, "0.0.0.0", async () => {
  if (AS_APP) {
    writePid();
    // Open the pairing page right away; it shows "Starting…" and auto-refreshes
    // to the QR once the tunnel resolves. (CUTSHORT_NO_OPEN suppresses all
    // browser/Settings/keystroke side effects — for headless or test runs.)
    if (!process.env.CUTSHORT_NO_OPEN) exec(`open "http://127.0.0.1:${PORT}/pair"`);
  }

  const lan = lanIPv4s()[0];
  console.log("┌──────────────────────────────────────────────┐");
  console.log(`│  ${APP_NAME} agent  ·  ${HOSTNAME} (${PLATFORM})`.padEnd(49) + "│");
  console.log("└──────────────────────────────────────────────┘");

  // Get the Accessibility grant out of the way up front. In app mode the row to
  // enable is "CutShort"; otherwise it's the detected host terminal/IDE.
  if (!process.env.CUTSHORT_NO_OPEN) {
    await ensureAccessibility({ rowName: AS_APP ? APP_NAME : undefined });
  }
  if (!HAS_APP) {
    console.log("ℹ  App bundle not found — QR codes will open the hosted deck");
    console.log(`   (${HOSTED_APP}) and connect back to this agent.`);
  }

  // Build the list of scan targets. Self-served (bundled app): scan the agent's
  // own origin, the app connects same-origin to /ws. Hosted fallback: open the
  // deck with the WS endpoint in a #connect= param. LAN+hosted is intentionally
  // skipped (an https page can't open an insecure ws:// to your LAN).
  // The token rides in the URL fragment for self-served decks (#t=… — never sent
  // to the server, only read by the app after a scan) and as a ?t= query for the
  // ws:// paste / hosted-fallback paths.
  const entries = [];
  if (lan) {
    if (HAS_APP) entries.push({ label: "Same WiFi (LAN)", url: `http://${lan}:${PORT}/#t=${AUTH_TOKEN}` });
    else entries.push({ label: "Same WiFi — paste in app", url: `ws://${lan}:${PORT}/ws?t=${AUTH_TOKEN}` });
  }

  console.log("\n🌐  Opening public tunnel…");
  const tunnel = await openTunnel(PORT);
  if (tunnel) {
    const wsUrl = tunnel.url.replace(/^https/, "wss") + "/ws?t=" + AUTH_TOKEN;
    const scan = HAS_APP
      ? `${tunnel.url}/#t=${AUTH_TOKEN}`
      : `${HOSTED_APP}/#connect=${encodeURIComponent(wsUrl)}`;
    entries.push({ label: `Anywhere (${tunnel.provider})`, url: scan });
    CURRENT_SHUTDOWN = () => {
      tunnel.close();
      clearPid();
      process.exit(0);
    };
  } else {
    CURRENT_SHUTDOWN = () => {
      clearPid();
      process.exit(0);
    };
    console.log("⚠  No tunnel provider found. Install cloudflared for remote access:");
    console.log("     brew install cloudflared   (macOS)");
    console.log("     winget install cloudflare.cloudflared   (Windows)");
    console.log("   LAN access above still works on the same WiFi.");
  }
  process.on("SIGINT", CURRENT_SHUTDOWN);
  process.on("SIGTERM", CURRENT_SHUTDOWN);

  if (AS_APP) {
    // No terminal: render the pairing page (the already-open browser tab picks
    // it up on its next refresh).
    PAIR_HTML = await renderPairPage({ entries, appName: APP_NAME, token: AUTH_TOKEN });
    console.log("Pairing page ready at /pair");
  } else {
    // Terminal: print the QR(s) inline as before.
    for (const e of entries) {
      const where = e.label.startsWith("Anywhere")
        ? "   Scan from anywhere:"
        : "   Scan on the same network:";
      if (e.url.startsWith("ws://")) console.log(`\n🛜  ${e.label}:  ${e.url}  (paste this in the app)`);
      else await printQR(e.url, where);
    }
  }

  console.log("\nWaiting for a phone to connect…\n");
});

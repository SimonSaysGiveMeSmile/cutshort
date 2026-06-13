#!/usr/bin/env node
// CutShort desktop agent
// ----------------------
// 1. Serves the built phone app (../dist) so scanning the QR opens a working
//    deck from THIS machine — same-origin, no Vercel needed.
// 2. Upgrades /ws and injects every combo it receives as a real keystroke.
// 3. Opens a Cloudflare Quick Tunnel and prints a QR of the public URL.
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
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import QRCode from "qrcode";
import { injectCombo } from "./keys.js";
import { openTunnel } from "./tunnel.js";
import { ensureAccessibility } from "./macAccess.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Prefer a dist bundled inside the published package; fall back to the repo's
// sibling dist when running from a clone.
const DIST = [
  path.resolve(__dirname, "..", "dist"), // published package: agent/dist
  path.resolve(__dirname, "..", "..", "dist"), // repo dev: <root>/dist
].find((p) => fs.existsSync(path.join(p, "index.html")));
const HAS_APP = !!DIST;
// When the app isn't bundled, point the QR at the hosted deck instead.
const HOSTED_APP = process.env.CUTSHORT_APP || "https://cutshort.online";
const PORT = Number(process.env.CUTSHORT_PORT || 8787);
const HOSTNAME = os.hostname().replace(/\.local$/, "");
const PLATFORM = process.platform === "darwin" ? "mac" : "win";
const VERSION = "0.1.0";

// ── static file server (serves the SPA) ───────────────────────────
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

function serveStatic(req, res) {
  if (req.url === "/health" || req.url === "/api/ping") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, host: HOSTNAME, os: PLATFORM, version: VERSION }));
    return;
  }
  if (!HAS_APP) {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("CutShort agent is running. Scan the QR from the terminal to open the deck.");
    return;
  }
  let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
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
const wss = new WebSocketServer({ server, path: "/ws" });

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
function lanIPs() {
  const out = [];
  for (const addrs of Object.values(os.networkInterfaces() || {})) {
    for (const a of addrs || []) {
      if (!a.internal && (a.family === "IPv4" || a.family === 4)) out.push(a.address);
    }
  }
  return out;
}

async function printQR(url, label) {
  const qr = await QRCode.toString(url, { type: "terminal", small: true });
  console.log(`\n${label}\n${qr}`);
}

server.listen(PORT, "0.0.0.0", async () => {
  const lan = lanIPs()[0];
  console.log("┌──────────────────────────────────────────────┐");
  console.log(`│  CutShort agent  ·  ${HOSTNAME} (${PLATFORM})`.padEnd(49) + "│");
  console.log("└──────────────────────────────────────────────┘");

  // Get the Accessibility grant out of the way up front, naming the exact app.
  await ensureAccessibility();
  if (!HAS_APP) {
    console.log("ℹ  App bundle not found — QR codes will open the hosted deck");
    console.log(`   (${HOSTED_APP}) and connect back to this agent.`);
  }
  // Self-served (bundled app): scan the agent's own origin, the app connects
  // same-origin to /ws. Hosted fallback: open the deck with the WS endpoint in
  // a #connect= param. LAN+hosted is intentionally skipped (an https page can't
  // open an insecure ws:// to your LAN — mixed content).
  if (lan) {
    if (HAS_APP) {
      const lanUrl = `http://${lan}:${PORT}/`;
      console.log(`\n🛜  LAN (same WiFi):  ${lanUrl}`);
      await printQR(lanUrl, "   Scan on the same network:");
    } else {
      console.log(`\n🛜  LAN (same WiFi):  ws://${lan}:${PORT}/ws  (paste this in the app)`);
    }
  }

  console.log("\n🌐  Opening public tunnel…");
  const tunnel = await openTunnel(PORT);
  if (tunnel) {
    const wsUrl = tunnel.url.replace(/^https/, "wss") + "/ws";
    const scan = HAS_APP
      ? `${tunnel.url}/`
      : `${HOSTED_APP}/#connect=${encodeURIComponent(wsUrl)}`;
    console.log(`✅  ${tunnel.provider}:  ${tunnel.url}/`);
    await printQR(scan, "   Scan from anywhere:");
    const shutdown = () => {
      tunnel.close();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } else {
    console.log("⚠  No tunnel provider found. Install cloudflared for remote access:");
    console.log("     brew install cloudflared   (macOS)");
    console.log("     winget install cloudflare.cloudflared   (Windows)");
    console.log("   LAN access above still works on the same WiFi.");
  }
  console.log("\nWaiting for a phone to connect…\n");
});

// Public tunnel — ported from soa-web (server/src/tunnel.js), trimmed to the
// essentials: Cloudflare Quick Tunnel first (free, no account, supports
// WebSockets), then ngrok if present. Best-effort: a failure here never stops
// the local LAN server. Returns { url, close() } or null.

import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";

// Pull the public URL out of a provider's log stream. Exported and pure so these
// format-specific regexes are unit-testable — a silent break here means remote
// access quietly degrades to LAN-only with no visible error.
export function extractCloudflaredUrl(text) {
  const m = String(text).match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
  return m ? m[0] : null;
}
export function extractNgrokUrl(text) {
  // Require https specifically: ngrok can emit a url=http:// "started tunnel"
  // line too, and grabbing it would break the wss:// upgrade (index.js rewrites
  // ^https→wss, a no-op on http). Exclude quotes/commas so a quoted or
  // comma-terminated value doesn't get swallowed into the URL.
  const m = String(text).match(/url="?(https:\/\/[^\s",]+)/);
  return m ? m[1] : null;
}

// Reap spawned tunnel children on ANY agent exit. close() handles the normal
// path, but the child is already running during the up-to-30s startup await
// (before close() is wired up) and on a hard exit close() never runs — without
// this, a Ctrl-C/SIGTERM/crash in that window orphans cloudflared, leaving a
// public URL pointing at a dead port.
const liveChildren = new Set();
let reaperInstalled = false;
function track(proc) {
  liveChildren.add(proc);
  proc.on("exit", () => liveChildren.delete(proc));
  if (!reaperInstalled) {
    reaperInstalled = true;
    process.on("exit", () => {
      for (const c of liveChildren) {
        try {
          c.kill("SIGTERM");
        } catch {
          /* already gone */
        }
      }
    });
  }
  return proc;
}

// Read a child's stdout+stderr until `extract` finds the public URL, then resolve.
// Crucially it DETACHES the data listeners and frees the buffer on the first match:
// the child stays alive for the whole session and keeps logging (cloudflared emits
// heartbeats), so a listener left attached would append to an ever-growing buffer
// and re-scan it forever. On timeout it kills the child (an un-killed slow starter
// would otherwise establish an unused public tunnel for the rest of the session).
// `name` only flavors the error text. Pure enough to test with a fake child.
export function captureTunnelUrl(proc, extract, timeoutMs, name) {
  return new Promise((resolve, reject) => {
    let buf = "";
    let settled = false;
    const onData = (chunk) => {
      buf += chunk.toString();
      const url = extract(buf);
      if (url && !settled) {
        settled = true;
        buf = "";
        cleanup();
        resolve(url);
      }
    };
    const cleanup = () => {
      clearTimeout(timer);
      proc.stdout?.off?.("data", onData);
      proc.stderr?.off?.("data", onData);
    };
    const fail = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };
    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        /* already gone */
      }
      fail(new Error(`${name} timeout`));
    }, timeoutMs);
    proc.stdout?.on("data", onData);
    proc.stderr?.on("data", onData);
    proc.on("error", (e) => fail(e));
    proc.on("exit", (code) => fail(new Error(`${name} exited ${code}`)));
  });
}

function findBinary(name) {
  const candidates = [
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/usr/bin/${name}`,
    `/bin/${name}`,
    // Windows
    `C:/Program Files (x86)/cloudflared/${name}.exe`,
    `C:/Program Files/cloudflared/${name}.exe`,
  ];
  for (const c of candidates) {
    try {
      if (existsSync(c)) return Promise.resolve(c);
    } catch {
      /* ignore */
    }
  }
  return new Promise((resolve) => {
    const which = process.platform === "win32" ? "where" : "which";
    execFile(which, [name], (err, stdout) => {
      if (err || !stdout.trim()) return resolve(null);
      resolve(stdout.trim().split(/\r?\n/)[0]);
    });
  });
}

async function tryCloudflared(port) {
  const bin = await findBinary("cloudflared");
  if (!bin) return null;
  try {
    const proc = track(
      spawn(bin, ["tunnel", "--url", `http://localhost:${port}`], {
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
    const url = await captureTunnelUrl(proc, extractCloudflaredUrl, 30000, "cloudflared");
    return {
      provider: "cloudflared",
      url,
      close: () => {
        try {
          proc.kill();
        } catch {
          /* ignore */
        }
      },
    };
  } catch {
    return null;
  }
}

async function tryNgrok(port) {
  const bin = await findBinary("ngrok");
  if (!bin) return null;
  try {
    const proc = track(
      spawn(bin, ["http", String(port), "--log=stdout", "--log-format=logfmt"], {
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
    const url = await captureTunnelUrl(proc, extractNgrokUrl, 15000, "ngrok");
    return { provider: "ngrok", url, close: () => proc.kill() };
  } catch {
    return null;
  }
}

export async function openTunnel(port) {
  return (await tryCloudflared(port)) || (await tryNgrok(port)) || null;
}

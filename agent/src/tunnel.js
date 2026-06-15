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
  const m = String(text).match(/url=(https?:\/\/[^\s]+)/);
  return m ? m[1] : null;
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
    const proc = spawn(bin, ["tunnel", "--url", `http://localhost:${port}`], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const url = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        try {
          proc.kill();
        } catch {
          /* ignore */
        }
        reject(new Error("cloudflared timeout"));
      }, 30000);
      let buf = "";
      const onData = (chunk) => {
        buf += chunk.toString();
        const url = extractCloudflaredUrl(buf);
        if (url) {
          clearTimeout(timeout);
          resolve(url);
        }
      };
      proc.stdout.on("data", onData);
      proc.stderr.on("data", onData);
      proc.on("error", (e) => {
        clearTimeout(timeout);
        reject(e);
      });
      proc.on("exit", (code) => {
        clearTimeout(timeout);
        reject(new Error(`cloudflared exited ${code}`));
      });
    });
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
    const proc = spawn(bin, ["http", String(port), "--log=stdout", "--log-format=logfmt"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const url = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("ngrok timeout")), 15000);
      let buf = "";
      proc.stdout.on("data", (chunk) => {
        buf += chunk.toString();
        const url = extractNgrokUrl(buf);
        if (url) {
          clearTimeout(timeout);
          resolve(url);
        }
      });
      proc.on("error", (e) => {
        clearTimeout(timeout);
        reject(e);
      });
      proc.on("exit", (code) => {
        clearTimeout(timeout);
        reject(new Error(`ngrok exited ${code}`));
      });
    });
    return { provider: "ngrok", url, close: () => proc.kill() };
  } catch {
    return null;
  }
}

export async function openTunnel(port) {
  return (await tryCloudflared(port)) || (await tryNgrok(port)) || null;
}

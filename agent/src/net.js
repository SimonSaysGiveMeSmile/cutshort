// Network helpers
// ---------------
// Pulled out of index.js so they're testable without booting the server (just
// importing index.js starts the HTTP/WS listener). The address picked here is
// the LAN URL shown in the QR, so an empty/wrong result reads as "can't connect
// on the same WiFi".

import os from "node:os";

/**
 * Non-internal IPv4 addresses across all interfaces. Node reports `family` as
 * the string "IPv4" on older versions and the number 4 on newer ones, so we
 * accept both. Interfaces can be injected for testing.
 */
export function lanIPv4s(interfaces = os.networkInterfaces() || {}) {
  const out = [];
  for (const addrs of Object.values(interfaces)) {
    for (const a of addrs || []) {
      if (!a.internal && (a.family === "IPv4" || a.family === 4)) out.push(a.address);
    }
  }
  return out;
}

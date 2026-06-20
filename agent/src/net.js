// Network helpers
// ---------------
// Pulled out of index.js so they're testable without booting the server (just
// importing index.js starts the HTTP/WS listener). The address picked here is
// the LAN URL shown in the QR, so an empty/wrong result reads as "can't connect
// on the same WiFi".

import os from "node:os";

// Interface-name prefixes for virtual/VPN/VM/container adapters. A phone on the
// real WiFi can't reach an address on one of these, so they're deprioritized
// (kept as a fallback, never picked over a physical adapter).
const VIRTUAL_PREFIXES = [
  "utun",
  "bridge",
  "vboxnet",
  "vmnet",
  "docker",
  "tun",
  "tap",
  "awdl",
  "llw",
  "vethernet",
  "ham",
];

const isVirtual = (name) => {
  const n = name.toLowerCase();
  return VIRTUAL_PREFIXES.some((p) => n.startsWith(p));
};

/**
 * Non-internal, routable IPv4 addresses across all interfaces, physical first.
 * Node reports `family` as the string "IPv4" on older versions and the number 4
 * on newer ones, so we accept both. APIPA link-local (169.254.x.x) addresses are
 * never routable to a phone, so they're dropped. Callers typically take [0] as
 * THE LAN address shown in the QR, so ordering matters: a Docker/VPN/VM adapter
 * must not shadow the real WiFi interface. Interfaces can be injected for tests.
 */
export function lanIPv4s(interfaces = os.networkInterfaces() || {}) {
  const physical = [];
  const virtual = [];
  for (const [name, addrs] of Object.entries(interfaces)) {
    for (const a of addrs || []) {
      if (a.internal) continue;
      if (a.family !== "IPv4" && a.family !== 4) continue;
      if (a.address.startsWith("169.254.")) continue; // link-local, unroutable
      (isVirtual(name) ? virtual : physical).push(a.address);
    }
  }
  return [...physical, ...virtual];
}

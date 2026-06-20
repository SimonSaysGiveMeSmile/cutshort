// Pairing-token auth
// ------------------
// The agent injects real keystrokes into the logged-in desktop session, so the
// WebSocket (and the control POST endpoints) must not be reachable by anyone who
// merely learns the LAN address or the public tunnel URL. We mint a high-entropy
// token at startup, hand it to the phone only via the QR/pairing fragment, and
// require it on every privileged request. These helpers are pure so they can be
// unit-tested without standing up a server.

import crypto from "node:crypto";

/** A fresh, URL-safe pairing secret (128 bits). */
export function generateToken() {
  return crypto.randomBytes(16).toString("base64url");
}

/** Extract the `t` query param from a request URL (handles bare paths). */
export function tokenFromUrl(reqUrl) {
  try {
    return new URL(reqUrl, "http://localhost").searchParams.get("t");
  } catch {
    return null;
  }
}

/** Constant-time token comparison; false for any nullish / mismatched input. */
export function tokensMatch(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length === 0) return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

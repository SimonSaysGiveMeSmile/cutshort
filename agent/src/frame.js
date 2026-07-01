// Inbound frame parsing
// ---------------------
// Parse + shape-guard a raw WebSocket message before the agent acts on it. The
// socket handler used to `JSON.parse(raw).t` directly, which throws on a payload
// like `null` (JSON.parse("null") === null, and null.t is a TypeError) — an
// uncaught rejection from a single malformed frame. This centralizes the guard
// and returns only the two frame kinds the agent handles, or null to ignore.

/**
 * @param {string|Buffer} raw
 * @returns {{ t: "ping" } | { t: "key", d: object } | null}
 */
export function parseInboundFrame(raw) {
  let frame;
  try {
    frame = JSON.parse(typeof raw === "string" ? raw : raw.toString());
  } catch {
    return null; // not JSON
  }
  // Reject anything that isn't a plain object: null / numbers / strings / arrays
  // all have (or throw on) a `.t` access and none are valid frames.
  if (!frame || typeof frame !== "object" || Array.isArray(frame)) return null;
  if (frame.t === "ping") return { t: "ping" };
  // A key frame must carry a plain-object payload; injectCombo reads d.mods/d.key.
  if (frame.t === "key" && frame.d && typeof frame.d === "object" && !Array.isArray(frame.d)) {
    return { t: "key", d: frame.d };
  }
  return null; // unknown type / malformed key frame
}

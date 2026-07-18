// Pairing scan-target URLs (pure)
// -------------------------------
// Builds the "scan me" entries the QR / pairing page renders. The security-critical
// bit is WHERE the per-run token rides: for a self-served deck (the agent serves the
// SPA itself) it must ride in the URL *fragment* (#t=…) so the browser never sends it
// to the server on the initial page load — a query (?t=) would land in HTTP access
// logs and the tunnel provider's logs. The ws:// paste / hosted-fallback paths have
// no such page load, so there the token is a query on the socket URL. Extracted from
// index.js so this placement is unit-testable without booting the listeners.

/**
 * The same-WiFi (LAN) scan target, or null when there's no routable LAN address.
 * Self-served (hasApp): an http origin whose *fragment* carries the token so the deck
 * opens already paired. No bundle: a ws:// endpoint to paste into the hosted app,
 * with the token as a query on that socket URL.
 */
export function lanScanEntry({ lan, port, hasApp, token }) {
  if (!lan) return null;
  return hasApp
    ? { label: "Same WiFi (LAN)", url: `http://${lan}:${port}/#t=${token}` }
    : { label: "Same WiFi — paste in app", url: `ws://${lan}:${port}/ws?t=${token}` };
}

/**
 * The public-tunnel scan target. Self-served: the tunnel origin with the token in the
 * *fragment*. Hosted fallback: the hosted deck opened with the full wss:// socket URL
 * (token as a query on that socket URL) in a #connect= param — itself a fragment, so
 * the token still never hits the hosted app's server.
 */
export function tunnelScanEntry({ tunnelUrl, provider, hasApp, hostedApp, token }) {
  const wsUrl = tunnelUrl.replace(/^https/, "wss") + "/ws?t=" + token;
  const url = hasApp
    ? `${tunnelUrl}/#t=${token}`
    : `${hostedApp}/#connect=${encodeURIComponent(wsUrl)}`;
  return { label: `Anywhere (${provider})`, url };
}

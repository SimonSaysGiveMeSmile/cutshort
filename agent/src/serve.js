// HTTP routing + path-containment decisions (pure)
// -------------------------------------------------
// Extracted from index.js so the security-critical logic — what each of the two
// listeners exposes, which control POSTs require the pairing token, and the
// static-file traversal containment that faces the PUBLIC tunnel — is unit-
// testable without booting a live http.Server (importing index.js starts the
// listeners and can call process.exit). index.js keeps the thin I/O adapters
// (realpath, stat, readFile, res writes, side effects) that execute these
// decisions; only the branch selection lives here. Mirrors the auth.js pattern:
// pure helpers "so they can be unit-tested without standing up a server".

import path from "node:path";

/** True iff `p` is `distRoot` itself or a path strictly inside it. The
 *  `+ path.sep` matters: a bare startsWith would wrongly admit a sibling like
 *  `/app/dist-evil` for a root of `/app/dist`. */
export function withinDist(p, distRoot) {
  return p === distRoot || p.startsWith(distRoot + path.sep);
}

/**
 * Lexical containment for a static request on the PUBLIC (tunnel-reachable)
 * listener. Given the raw request url and the resolved dist root, return the
 * contained on-disk path to read, or null when the request is malformed
 * (bad %-encoding, poison null byte) or escapes dist via "../"/absolute paths.
 * Pure: does NO I/O. The realpath/symlink + stat containment stays in the
 * caller, which touches the filesystem. Behaviour must match index.js exactly:
 * a regression here (dropping the leading ".", the null-byte guard, or the
 * withinDist check) silently reopens arbitrary-file-read over the tunnel.
 */
export function resolveStaticPath(url, distRoot) {
  let urlPath;
  try {
    urlPath = decodeURIComponent((url || "/").split("?")[0]);
  } catch {
    return null; // malformed percent-encoding
  }
  if (urlPath.includes("\0")) return null; // poison null byte
  if (urlPath === "/") urlPath = "/index.html";
  // Resolve against distRoot with a leading "." so absolute-looking ("/etc/x")
  // or "../"-laden requests are pinned inside dist instead of escaping it.
  const resolved = path.resolve(distRoot, "." + urlPath);
  return withinDist(resolved, distRoot) ? resolved : null;
}

/**
 * What the PUBLIC listener should do with a request, WITHOUT touching res:
 *   { kind: "health" }              -> the info-free {ok,version} probe
 *   { kind: "info" }                -> the no-bundle text placeholder
 *   { kind: "static", filePath }    -> serve a contained file
 *   { kind: "forbidden" }           -> 403 (malformed / traversal escape)
 * The public listener deliberately never routes /pair or the control POSTs —
 * those are loopback-only (see routeLocal). /health is answered even when the
 * bundle is absent, and must stay info-free (no host/os — see healthPayload).
 */
export function routePublic({ url, hasApp, distRoot }) {
  const p = (url || "/").split("?")[0];
  if (p === "/health" || p === "/api/ping") return { kind: "health" };
  if (!hasApp) return { kind: "info" };
  const filePath = resolveStaticPath(url, distRoot);
  return filePath ? { kind: "static", filePath } : { kind: "forbidden" };
}

/** The /health payload. Must NOT carry host/os: /health is unauthenticated and
 *  reachable over the public tunnel, and the hostname is often the owner's real
 *  name. host/os ride the token-gated `hello` frame instead. */
export function healthPayload(version) {
  return { ok: true, version };
}

/**
 * What the LOOPBACK control listener should do, WITHOUT touching res:
 *   { kind: "quit" | "accessibility" }  -> a mutating action (token required)
 *   { kind: "forbidden" }               -> 403 (control POST without a token)
 *   { kind: "pair" }                    -> serve the pairing page
 *   { kind: "notfound" }                -> 404
 * The two mutating POSTs are gated on `authed` (a valid pairing token); a GET to
 * them is NOT treated as the action (POST-only) and falls through to 404.
 */
export function routeLocal({ method, url, authed }) {
  const p = (url || "/").split("?")[0];
  if (method === "POST" && p === "/api/quit") return authed ? { kind: "quit" } : { kind: "forbidden" };
  if (method === "POST" && p === "/api/open-accessibility") {
    return authed ? { kind: "accessibility" } : { kind: "forbidden" };
  }
  if (p === "/pair") return { kind: "pair" };
  return { kind: "notfound" };
}

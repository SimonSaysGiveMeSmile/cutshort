import { describe, it, expect } from "vitest";
import path from "node:path";
import {
  withinDist,
  resolveStaticPath,
  routePublic,
  healthPayload,
  routeLocal,
} from "./serve.js";

// A POSIX-style dist root; path.resolve/path.sep are "/" on the test host.
const DIST = "/app/dist";

describe("withinDist", () => {
  it("accepts the root itself and paths strictly inside it", () => {
    expect(withinDist(DIST, DIST)).toBe(true);
    expect(withinDist(path.join(DIST, "index.html"), DIST)).toBe(true);
    expect(withinDist(path.join(DIST, "assets", "app.js"), DIST)).toBe(true);
  });

  it("rejects a sibling directory that shares the root as a string prefix", () => {
    // The whole point of the `+ path.sep`: a bare startsWith(distRoot) would wrongly
    // admit "/app/dist-evil" (and read files outside the served bundle).
    expect(withinDist("/app/dist-evil", DIST)).toBe(false);
    expect(withinDist("/app/dist-evil/secret", DIST)).toBe(false);
    expect(withinDist("/etc/passwd", DIST)).toBe(false);
  });
});

describe("resolveStaticPath — public-tunnel traversal containment", () => {
  it("maps / to index.html and serves normal contained paths", () => {
    expect(resolveStaticPath("/", DIST)).toBe(path.join(DIST, "index.html"));
    expect(resolveStaticPath("/assets/app.js", DIST)).toBe(path.join(DIST, "assets", "app.js"));
  });

  it("strips the query string before resolving", () => {
    expect(resolveStaticPath("/assets/app.js?v=123", DIST)).toBe(path.join(DIST, "assets", "app.js"));
    expect(resolveStaticPath("/?t=abc", DIST)).toBe(path.join(DIST, "index.html"));
  });

  it("rejects ../ traversal, raw and percent-encoded", () => {
    expect(resolveStaticPath("/../../etc/passwd", DIST)).toBeNull();
    expect(resolveStaticPath("/..%2f..%2fetc%2fpasswd", DIST)).toBeNull(); // decodes to ../../
    expect(resolveStaticPath("/%2e%2e/%2e%2e/etc/passwd", DIST)).toBeNull();
  });

  it("pins an absolute-looking path inside dist instead of escaping (leading '.')", () => {
    // "/etc/passwd" resolves to <dist>/etc/passwd — contained, not the host's file.
    expect(resolveStaticPath("/etc/passwd", DIST)).toBe(path.join(DIST, "etc", "passwd"));
  });

  it("rejects a poison null byte", () => {
    expect(resolveStaticPath("/foo%00.js", DIST)).toBeNull();
    expect(resolveStaticPath("/foo\0.js", DIST)).toBeNull();
  });

  it("rejects malformed percent-encoding instead of throwing", () => {
    expect(resolveStaticPath("/%zz", DIST)).toBeNull();
    expect(resolveStaticPath("/%", DIST)).toBeNull();
  });
});

describe("routePublic — what the tunnel-facing listener exposes", () => {
  it("answers /health and /api/ping even when the bundle is absent", () => {
    expect(routePublic({ url: "/health", hasApp: false, distRoot: DIST })).toEqual({ kind: "health" });
    expect(routePublic({ url: "/api/ping", hasApp: true, distRoot: DIST })).toEqual({ kind: "health" });
    // health wins over static even with a query string
    expect(routePublic({ url: "/health?x=1", hasApp: true, distRoot: DIST })).toEqual({ kind: "health" });
  });

  it("serves the text placeholder for any non-health request when no bundle", () => {
    expect(routePublic({ url: "/index.html", hasApp: false, distRoot: DIST })).toEqual({ kind: "info" });
    expect(routePublic({ url: "/whatever", hasApp: false, distRoot: DIST })).toEqual({ kind: "info" });
  });

  it("serves a contained file and forbids an escape when the bundle is present", () => {
    expect(routePublic({ url: "/assets/app.js", hasApp: true, distRoot: DIST })).toEqual({
      kind: "static",
      filePath: path.join(DIST, "assets", "app.js"),
    });
    expect(routePublic({ url: "/../../etc/passwd", hasApp: true, distRoot: DIST })).toEqual({ kind: "forbidden" });
    expect(routePublic({ url: "/foo%00.js", hasApp: true, distRoot: DIST })).toEqual({ kind: "forbidden" });
  });

  it("never routes the loopback-only surfaces onto the public listener", () => {
    // /pair and the control POSTs must be unreachable here — they'd just be treated
    // as static file requests (which won't exist in dist) or the info placeholder.
    for (const url of ["/pair", "/api/quit", "/api/open-accessibility"]) {
      const r = routePublic({ url, hasApp: true, distRoot: DIST });
      expect(r.kind).not.toBe("pair");
      expect(r.kind).not.toBe("quit");
      expect(r.kind).not.toBe("accessibility");
    }
  });
});

describe("healthPayload — info-free probe", () => {
  it("carries only ok + version, never host/os", () => {
    const p = healthPayload("0.1.0");
    expect(p).toEqual({ ok: true, version: "0.1.0" });
    // The hostname is often the owner's real name; it must not ride the public probe.
    expect(Object.keys(p).sort()).toEqual(["ok", "version"]);
    expect(p).not.toHaveProperty("host");
    expect(p).not.toHaveProperty("os");
  });
});

describe("routeLocal — loopback control gating", () => {
  it("gates the mutating POSTs on a valid pairing token", () => {
    expect(routeLocal({ method: "POST", url: "/api/quit", authed: true })).toEqual({ kind: "quit" });
    expect(routeLocal({ method: "POST", url: "/api/quit", authed: false })).toEqual({ kind: "forbidden" });
    expect(routeLocal({ method: "POST", url: "/api/open-accessibility", authed: true })).toEqual({
      kind: "accessibility",
    });
    expect(routeLocal({ method: "POST", url: "/api/open-accessibility", authed: false })).toEqual({
      kind: "forbidden",
    });
  });

  it("carries the token through the query string transparently (routeLocal sees only the path)", () => {
    expect(routeLocal({ method: "POST", url: "/api/quit?t=tok", authed: true })).toEqual({ kind: "quit" });
  });

  it("is POST-only: a GET to a control route is not the action", () => {
    // A GET /api/quit must never quit — it falls through to 404, not the action, and
    // never to forbidden (which would imply the route matched).
    expect(routeLocal({ method: "GET", url: "/api/quit", authed: true })).toEqual({ kind: "notfound" });
    expect(routeLocal({ method: "GET", url: "/api/open-accessibility", authed: true })).toEqual({
      kind: "notfound",
    });
  });

  it("serves /pair for any method and 404s everything else", () => {
    expect(routeLocal({ method: "GET", url: "/pair", authed: false })).toEqual({ kind: "pair" });
    expect(routeLocal({ method: "GET", url: "/", authed: false })).toEqual({ kind: "notfound" });
    expect(routeLocal({ method: "GET", url: "/index.html", authed: true })).toEqual({ kind: "notfound" });
  });
});

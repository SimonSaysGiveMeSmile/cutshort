import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { extractCloudflaredUrl, extractNgrokUrl, captureTunnelUrl } from "./tunnel.js";

// A spawn()-shaped stand-in: stdout/stderr are EventEmitters, plus a kill spy, so
// captureTunnelUrl can be exercised without launching cloudflared/ngrok.
function fakeProc() {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  return proc;
}

// These regexes parse another program's log output, so they break silently when
// cloudflared/ngrok tweak their format — and the only symptom is "remote access
// stopped working". Pin them against realistic samples.

describe("extractCloudflaredUrl", () => {
  // cloudflared prints the URL inside a boxed banner, usually on stderr.
  const banner = `2024-05-01T12:00:00Z INF Thank you for trying Cloudflare Tunnel.
2024-05-01T12:00:00Z INF +--------------------------------------------------------+
2024-05-01T12:00:00Z INF |  Your quick Tunnel has been created! Visit it at:       |
2024-05-01T12:00:00Z INF |  https://calm-river-1234.trycloudflare.com             |
2024-05-01T12:00:00Z INF +--------------------------------------------------------+`;

  it("pulls the trycloudflare URL out of the banner", () => {
    expect(extractCloudflaredUrl(banner)).toBe("https://calm-river-1234.trycloudflare.com");
  });

  it("returns null while the URL line hasn't been printed yet (partial buffer)", () => {
    expect(extractCloudflaredUrl("INF Thank you for trying Cloudflare Tunnel.")).toBeNull();
    expect(extractCloudflaredUrl("")).toBeNull();
  });

  it("ignores other https URLs and only matches the tunnel host", () => {
    const noise = "see https://developers.cloudflare.com/ for docs";
    expect(extractCloudflaredUrl(noise)).toBeNull();
  });
});

describe("extractNgrokUrl", () => {
  const logfmt =
    't=2024-05-01T12:00:00+0000 lvl=info msg="started tunnel" name=command_line ' +
    "addr=http://localhost:8787 url=https://1a2b-3-4-5-6.ngrok-free.app";

  it("captures the url= field from logfmt output", () => {
    expect(extractNgrokUrl(logfmt)).toBe("https://1a2b-3-4-5-6.ngrok-free.app");
  });

  it("stops at whitespace so trailing log fields aren't swallowed", () => {
    const trailing = "addr=http://localhost:8787 url=https://x.ngrok.app obj=tunnels";
    expect(extractNgrokUrl(trailing)).toBe("https://x.ngrok.app");
  });

  it("returns null before a url= field appears", () => {
    expect(extractNgrokUrl('lvl=info msg="starting"')).toBeNull();
    expect(extractNgrokUrl("")).toBeNull();
  });

  it("picks the https tunnel when ngrok also prints an http one", () => {
    const both =
      'msg="started tunnel" addr=http://localhost:8787 url=http://1a2b.ngrok-free.app\n' +
      'msg="started tunnel" addr=http://localhost:8787 url=https://1a2b.ngrok-free.app';
    expect(extractNgrokUrl(both)).toBe("https://1a2b.ngrok-free.app");
  });

  it("doesn't swallow surrounding quotes or a trailing comma", () => {
    expect(extractNgrokUrl('url="https://x.ngrok.app"')).toBe("https://x.ngrok.app");
    expect(extractNgrokUrl("url=https://x.ngrok.app, obj=tunnels")).toBe("https://x.ngrok.app");
  });
});

describe("captureTunnelUrl", () => {
  it("resolves with the first matched URL from stderr", async () => {
    const proc = fakeProc();
    const p = captureTunnelUrl(proc, extractCloudflaredUrl, 30000, "cloudflared");
    proc.stderr.emit("data", "INF Visit it at: https://calm-river-1234.trycloudflare.com\n");
    await expect(p).resolves.toBe("https://calm-river-1234.trycloudflare.com");
  });

  it("detaches its data listeners after capture so the buffer can't grow unbounded", async () => {
    const proc = fakeProc();
    const p = captureTunnelUrl(proc, extractNgrokUrl, 30000, "ngrok");
    proc.stdout.emit("data", "url=https://abc.ngrok-free.app\n");
    await p;
    // The long-lived child keeps logging; with listeners detached, none of it is
    // buffered or re-scanned for the rest of the session.
    expect(proc.stdout.listenerCount("data")).toBe(0);
    expect(proc.stderr.listenerCount("data")).toBe(0);
  });

  it("accumulates across chunks until the URL appears", async () => {
    const proc = fakeProc();
    const p = captureTunnelUrl(proc, extractCloudflaredUrl, 30000, "cloudflared");
    proc.stdout.emit("data", "https://calm-");
    proc.stdout.emit("data", "river-99.trycloudflare.com rest");
    await expect(p).resolves.toBe("https://calm-river-99.trycloudflare.com");
  });

  it("kills the child and rejects on timeout (no orphaned tunnel)", async () => {
    vi.useFakeTimers();
    try {
      const proc = fakeProc();
      const p = captureTunnelUrl(proc, extractNgrokUrl, 15000, "ngrok");
      const assertion = expect(p).rejects.toThrow("ngrok timeout");
      await vi.advanceTimersByTimeAsync(15000);
      await assertion;
      expect(proc.kill).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects if the child exits before printing a URL", async () => {
    const proc = fakeProc();
    const p = captureTunnelUrl(proc, extractCloudflaredUrl, 30000, "cloudflared");
    proc.emit("exit", 1);
    await expect(p).rejects.toThrow("cloudflared exited 1");
  });
});

import { describe, it, expect } from "vitest";
import { extractCloudflaredUrl, extractNgrokUrl } from "./tunnel.js";

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
});

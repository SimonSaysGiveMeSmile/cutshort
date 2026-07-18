import { describe, it, expect } from "vitest";
import { lanScanEntry, tunnelScanEntry } from "./scanEntries.js";

const TOKEN = "tok_ABC123";

// The part of a URL a browser WOULD send to the server on load (everything before
// the "#" fragment). The token must never appear here for a self-served deck.
function sentToServer(url) {
  return url.split("#")[0];
}

describe("lanScanEntry", () => {
  it("returns null when there's no routable LAN address", () => {
    expect(lanScanEntry({ lan: undefined, port: 8787, hasApp: true, token: TOKEN })).toBeNull();
    expect(lanScanEntry({ lan: "", port: 8787, hasApp: true, token: TOKEN })).toBeNull();
  });

  it("self-served: token rides in the fragment, never the server-visible part", () => {
    const e = lanScanEntry({ lan: "192.168.1.5", port: 8787, hasApp: true, token: TOKEN });
    expect(e.url).toBe("http://192.168.1.5:8787/#t=tok_ABC123");
    expect(e.url).toContain(`#t=${TOKEN}`);
    // the crown-jewel invariant: the token is NOT in what the browser sends to the server
    expect(sentToServer(e.url)).not.toContain(TOKEN);
    expect(sentToServer(e.url)).not.toContain("t=");
  });

  it("no-bundle: a ws:// socket URL carries the token as a query (no page load to leak it)", () => {
    const e = lanScanEntry({ lan: "192.168.1.5", port: 8787, hasApp: false, token: TOKEN });
    expect(e.url).toBe("ws://192.168.1.5:8787/ws?t=tok_ABC123");
  });
});

describe("tunnelScanEntry", () => {
  it("self-served: token rides in the fragment of the tunnel origin, not the server-visible part", () => {
    const e = tunnelScanEntry({
      tunnelUrl: "https://abc123.trycloudflare.com",
      provider: "cloudflare",
      hasApp: true,
      hostedApp: "https://cutshort.online",
      token: TOKEN,
    });
    expect(e.label).toBe("Anywhere (cloudflare)");
    expect(e.url).toBe("https://abc123.trycloudflare.com/#t=tok_ABC123");
    expect(sentToServer(e.url)).not.toContain(TOKEN); // never sent to the tunnel/server
  });

  it("hosted fallback: opens the hosted deck with the full wss socket URL in a #connect= fragment", () => {
    const e = tunnelScanEntry({
      tunnelUrl: "https://abc123.trycloudflare.com",
      provider: "ngrok",
      hasApp: false,
      hostedApp: "https://cutshort.online",
      token: TOKEN,
    });
    // https origin becomes a secure wss socket URL; token is a query on THAT url
    const expectedWs = "wss://abc123.trycloudflare.com/ws?t=tok_ABC123";
    expect(e.url).toBe(`https://cutshort.online/#connect=${encodeURIComponent(expectedWs)}`);
    // the token still never hits the hosted app's server — it's inside the fragment
    expect(sentToServer(e.url)).not.toContain(TOKEN);
    // and the encoded socket URL round-trips back to the secure wss endpoint
    const connect = decodeURIComponent(e.url.split("#connect=")[1]);
    expect(connect).toBe(expectedWs);
    expect(connect.startsWith("wss://")).toBe(true); // never downgraded to ws://
  });
});

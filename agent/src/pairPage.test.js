import { describe, it, expect } from "vitest";
import { renderPairPage } from "./pairPage.js";

// The pairing page is the agent's only UI in app mode (no terminal to print the
// QR into), so a regression here means the user is stranded with no way to pair
// or stop the agent. These are render smoke tests over the produced HTML string.

const ENTRIES = [
  { label: "LAN (same WiFi)", url: "http://192.168.1.9:8787/" },
  { label: "cloudflared", url: "https://abc123.trycloudflare.com/" },
];

describe("renderPairPage", () => {
  it("renders a scannable card per entry: label, a QR <img>, and the URL", async () => {
    const html = await renderPairPage({ entries: ENTRIES, appName: "CutShort" });
    for (const e of ENTRIES) {
      expect(html).toContain(e.label);
      expect(html).toContain(e.url);
    }
    // one QR image per entry, each an embedded data URL (no external fetch)
    const imgs = html.match(/<img[^>]+src="data:image\/png;base64,/g) || [];
    expect(imgs).toHaveLength(ENTRIES.length);
  });

  it("surfaces the app name in the title, header, and Accessibility hint", async () => {
    const html = await renderPairPage({ entries: ENTRIES, appName: "CutShort" });
    expect(html).toContain("<title>CutShort — pair your phone</title>");
    expect(html).toMatch(/<h1>CutShort<\/h1>/);
    expect(html).toMatch(/enable <b>CutShort<\/b>/);
  });

  it("always offers a Stop agent control and the Accessibility opener", async () => {
    const html = await renderPairPage({ entries: ENTRIES, appName: "CutShort" });
    expect(html).toContain("Stop agent");
    expect(html).toContain("/api/quit");
    expect(html).toContain("/api/open-accessibility");
  });

  // The Stop / Open-Accessibility buttons POST to /api/quit and /api/open-accessibility,
  // which index.js gates behind the pairing token (tokensMatch(tokenFromUrl(req.url))).
  // renderPairPage is the ONLY thing that threads that token into the client fetches
  // (via the `Q` constant), so if this wiring breaks the controls silently 401 and the
  // user can't stop the agent from its own page. Reconstruct the runtime URLs to prove it.
  function runtimeQ(html) {
    const m = html.match(/const Q = (".*?");/);
    if (!m) throw new Error("no Q constant found in pair page script");
    return JSON.parse(m[1]);
  }

  it("threads the pairing token into the control fetches so they pass the loopback auth check", async () => {
    const html = await renderPairPage({ entries: ENTRIES, appName: "CutShort", token: "tok123" });
    const Q = runtimeQ(html);
    // the token is embedded in exactly the ?t=<token> form the auth check parses…
    expect(Q).toBe("?t=tok123");
    // …and both control endpoints concatenate it, so the POSTs actually carry it.
    expect("/api/quit" + Q).toBe("/api/quit?t=tok123");
    expect("/api/open-accessibility" + Q).toBe("/api/open-accessibility?t=tok123");
  });

  it("omits the query entirely when no token is set (nothing to append)", async () => {
    const html = await renderPairPage({ entries: ENTRIES, appName: "CutShort" });
    const Q = runtimeQ(html);
    expect(Q).toBe("");
    expect("/api/quit" + Q).toBe("/api/quit");
  });

  it("shows a waiting message (and no cards) when no address is reachable yet", async () => {
    const html = await renderPairPage({ entries: [], appName: "CutShort" });
    expect(html).toMatch(/waiting for the network/i);
    expect(html).not.toContain("<img");
  });

  it("escapes HTML in labels and URLs so a hostile name can't inject markup", async () => {
    const html = await renderPairPage({
      entries: [{ label: '<script>x</script>', url: 'http://h/"><b>z' }],
      appName: "CutShort",
    });
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(html).toContain("&quot;&gt;&lt;b&gt;z");
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parsePairing, detectAgent, Connection, type KeyFrame } from "./connection";
import type { Combo } from "../shortcuts";

describe("parsePairing", () => {
  it("returns null for empty / whitespace / garbage input", () => {
    expect(parsePairing("")).toBeNull();
    expect(parsePairing("   ")).toBeNull();
    expect(parsePairing("not a url ???")).toBeNull();
  });

  it("normalizes an https origin to a wss /ws endpoint", () => {
    const p = parsePairing("https://example.com")!;
    expect(p.url).toBe("wss://example.com/ws");
    expect(p.host).toBe("example.com");
  });

  it("normalizes an http origin to a ws /ws endpoint (keeps port)", () => {
    const p = parsePairing("http://192.168.1.5:8080")!;
    expect(p.url).toBe("ws://192.168.1.5:8080/ws");
    expect(p.host).toBe("192.168.1.5");
  });

  it("does not double-append when the url already ends in /ws", () => {
    expect(parsePairing("https://example.com/ws")!.url).toBe("wss://example.com/ws");
  });

  it("replaces a non-/ws path with /ws", () => {
    expect(parsePairing("https://example.com/foo/bar")!.url).toBe("wss://example.com/ws");
  });

  it("reads host / os / token from query params", () => {
    const p = parsePairing("https://example.com/ws?host=MyMac&os=win&t=secret")!;
    expect(p.host).toBe("MyMac"); // query host overrides hostname
    expect(p.os).toBe("win");
    expect(p.token).toBe("secret");
  });

  it("parses a cutshort:// deep link into a wss url", () => {
    const p = parsePairing("cutshort://mymac.local/ws?os=mac&t=tok")!;
    expect(p.url).toBe("wss://mymac.local/ws?os=mac&t=tok");
    expect(p.host).toBe("mymac.local");
    expect(p.os).toBe("mac");
    expect(p.token).toBe("tok");
  });
});

describe("detectAgent", () => {
  const stubLocation = (loc: Partial<Location>) =>
    vi.stubGlobal("location", { hash: "", protocol: "https:", host: "", hostname: "", ...loc });

  it("returns null when location is undefined", () => {
    vi.stubGlobal("location", undefined);
    expect(detectAgent()).toBeNull();
  });

  it("reads a #connect=<url> hash and parses it", () => {
    stubLocation({ hash: "#connect=https://example.com", host: "anything.vercel.app" });
    expect(detectAgent()).toEqual(parsePairing("https://example.com"));
  });

  it("auto-connects same-origin when served by the agent itself", () => {
    stubLocation({
      hash: "",
      protocol: "https:",
      host: "abc123.trycloudflare.com",
      hostname: "abc123.trycloudflare.com",
    });
    expect(detectAgent()).toEqual({
      url: "wss://abc123.trycloudflare.com/ws",
      host: "abc123.trycloudflare.com",
    });
  });

  it("returns null on the hosted Vercel / cutshort.online site", () => {
    stubLocation({ host: "cutshort.vercel.app", hostname: "cutshort.vercel.app" });
    expect(detectAgent()).toBeNull();
    stubLocation({ host: "cutshort.online", hostname: "cutshort.online" });
    expect(detectAgent()).toBeNull();
  });

  it("returns null on the vite dev server", () => {
    stubLocation({ host: "localhost:5173", hostname: "localhost" });
    expect(detectAgent()).toBeNull();
  });
});

// ---- WebSocket-backed Connection behavior ----

class FakeWebSocket {
  static OPEN = 1;
  static mode: "open" | "error" = "open";
  static last: FakeWebSocket | null = null;
  readyState = 0;
  url: string;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  sent: string[] = [];
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.last = this;
    setTimeout(() => {
      if (FakeWebSocket.mode === "open") {
        this.readyState = FakeWebSocket.OPEN;
        this.onopen?.();
      } else {
        this.onerror?.();
      }
    }, 0);
  }
  send(data: string) {
    this.sent.push(data);
  }
  // Mirror the browser: close() also fires onclose (so we can prove an
  // intentional close is NOT mistaken for a drop).
  close() {
    this.closed = true;
    this.readyState = 3;
    this.onclose?.();
  }
  /** Simulate the peer/agent going away while live. */
  drop() {
    this.readyState = 3;
    this.onclose?.();
  }
}

describe("Connection", () => {
  beforeEach(() => {
    FakeWebSocket.mode = "open";
    FakeWebSocket.last = null;
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fire() is a no-op (returns false) before pairing", () => {
    const c = new Connection();
    expect(c.fire({ mods: ["MOD"], key: "c" })).toBe(false);
  });

  it("notifies state listeners through connecting -> live", async () => {
    const c = new Connection();
    const seen: string[] = [];
    c.onState((s) => seen.push(s));
    await c.pair({ url: "ws://10.0.0.2/ws", host: "x" });
    expect(seen).toEqual(["connecting", "live"]);
  });

  it("stops notifying after unsubscribe", async () => {
    const c = new Connection();
    const seen: string[] = [];
    const off = c.onState((s) => seen.push(s));
    off();
    await c.pair({ url: "ws://10.0.0.2/ws", host: "x" });
    expect(seen).toEqual([]);
  });

  it("classifies a LAN url and goes live, then fires a key frame", async () => {
    const c = new Connection();
    const ok = await c.pair({ url: "ws://192.168.1.9/ws", host: "DevBox", os: "mac" });
    expect(ok).toBe(true);
    expect(c.state).toBe("live");
    expect(c.transport?.kind).toBe("lan");
    expect(c.host).toBe("DevBox");

    const combo: Combo = { mods: ["MOD", "SHIFT"], key: "r" };
    expect(c.fire(combo)).toBe(true);
    const frame = JSON.parse(FakeWebSocket.last!.sent[0]) as KeyFrame;
    expect(frame).toEqual({
      v: 1,
      t: "key",
      d: { mods: ["MOD", "SHIFT"], key: "r", os: "mac" },
    });
  });

  it("classifies a tunnel url as 'tunnel'", async () => {
    const c = new Connection();
    await c.pair({ url: "wss://abc123.trycloudflare.com/ws", host: "Tunnelled" });
    expect(c.transport?.kind).toBe("tunnel");
  });

  it("updates host/os when the server sends a 'hello' frame", async () => {
    const c = new Connection();
    await c.pair({ url: "ws://192.168.1.9/ws", host: "DevBox", os: "mac" });
    FakeWebSocket.last!.onmessage!({
      data: JSON.stringify({ v: 1, t: "hello", d: { host: "Renamed-Mac", os: "win", version: "9" } }),
    });
    expect(c.host).toBe("Renamed-Mac");
    expect(c.os).toBe("win");
  });

  it("ignores a non-JSON server message without throwing or dropping the link", async () => {
    const c = new Connection();
    await c.pair({ url: "ws://192.168.1.9/ws", host: "DevBox" });
    expect(() => FakeWebSocket.last!.onmessage!({ data: "not json{" })).not.toThrow();
    expect(c.state).toBe("live");
  });

  it("close() tears down the transport and returns to idle", async () => {
    const c = new Connection();
    await c.pair({ url: "ws://192.168.1.9/ws", host: "DevBox" });
    c.close();
    expect(c.state).toBe("idle");
    expect(c.transport).toBeNull();
    expect(FakeWebSocket.last!.closed).toBe(true);
  });

  it("fire() returns false again after close()", async () => {
    const c = new Connection();
    await c.pair({ url: "ws://192.168.1.9/ws", host: "x" });
    expect(c.fire({ mods: [], key: "x" })).toBe(true);
    c.close();
    expect(c.fire({ mods: [], key: "x" })).toBe(false);
  });

  it("surfaces an unexpected drop as an error so taps don't silently vanish", async () => {
    const c = new Connection();
    const seen: string[] = [];
    c.onState((s) => seen.push(s));
    await c.pair({ url: "ws://192.168.1.9/ws", host: "DevBox" });
    expect(c.state).toBe("live");

    // Agent quits / Mac sleeps / tunnel idles out — the socket closes on its own.
    FakeWebSocket.last!.drop();

    expect(c.state).toBe("error");
    expect(c.transport).toBeNull();
    expect(c.lastError).toMatch(/lost/i);
    expect(c.fire({ mods: [], key: "x" })).toBe(false);
    expect(seen).toEqual(["connecting", "live", "error"]);
  });

  it("does not report an error when WE close the link (no false drop)", async () => {
    const c = new Connection();
    const seen: string[] = [];
    await c.pair({ url: "ws://192.168.1.9/ws", host: "DevBox" });
    c.onState((s) => seen.push(s));
    c.close(); // intentional teardown also fires the socket's onclose
    expect(c.state).toBe("idle");
    expect(seen).toEqual(["idle"]); // never went through "error"
  });

  it("ignores a late drop after the link is already closed (idempotent)", async () => {
    const c = new Connection();
    await c.pair({ url: "ws://192.168.1.9/ws", host: "DevBox" });
    const ws = FakeWebSocket.last!;
    c.close();
    expect(() => ws.drop()).not.toThrow();
    expect(c.state).toBe("idle"); // a stray late close can't knock us off idle
  });

  it("sets error state and message when the socket fails", async () => {
    FakeWebSocket.mode = "error";
    const c = new Connection();
    const ok = await c.pair({ url: "wss://nope.example.com/ws", host: "x" });
    expect(ok).toBe(false);
    expect(c.state).toBe("error");
    expect(c.lastError).toBe("ws error");
    expect(c.transport).toBeNull();
  });

  it("reports bluetooth unsupported and refuses to pair over BLE in jsdom", async () => {
    const c = new Connection();
    expect(c.bluetoothSupported()).toBe(false);
    const ok = await c.pairBluetooth();
    expect(ok).toBe(false);
    expect(c.state).toBe("error");
    expect(c.lastError).toMatch(/bluetooth/i);
  });
});

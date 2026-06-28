import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parsePairing, detectAgent, Connection, bindAutoWake, type KeyFrame } from "./connection";
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

  it("parses a cutshort:// deep link into a wss /ws url (query lifted off)", () => {
    const p = parsePairing("cutshort://mymac.local/ws?os=mac&t=tok")!;
    expect(p.url).toBe("wss://mymac.local/ws"); // normalized; token/os carried separately
    expect(p.host).toBe("mymac.local");
    expect(p.os).toBe("mac");
    expect(p.token).toBe("tok");
  });

  it("normalizes a cutshort:// link with no explicit /ws path", () => {
    expect(parsePairing("cutshort://mymac.local")!.url).toBe("wss://mymac.local/ws");
  });

  it("keeps a wss:// paste secure (never downgrades to ws://)", () => {
    expect(parsePairing("wss://example.com/ws")!.url).toBe("wss://example.com/ws");
  });

  it("drops an unrecognized os value instead of trusting the deep link", () => {
    expect(parsePairing("https://x.example/ws?os=linux")!.os).toBeUndefined();
    expect(parsePairing("https://x.example/ws?os=")!.os).toBeUndefined();
    expect(parsePairing("https://x.example/ws?os=mac")!.os).toBe("mac");
    expect(parsePairing("https://x.example/ws?os=win")!.os).toBe("win");
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

  it("returns null on the dev server whatever port Vite landed on", () => {
    // Vite auto-increments when its port is taken, so the dev origin must be
    // excluded on 5174/5188/… too, not just the default 5173.
    for (const host of ["localhost:5174", "localhost:5188", "127.0.0.1:4321"]) {
      stubLocation({ host, hostname: host.split(":")[0] });
      expect(detectAgent()).toBeNull();
    }
  });

  it("reads a same-origin pairing token from the #t= fragment", () => {
    stubLocation({
      hash: "#t=hunter2",
      host: "abc123.trycloudflare.com",
      hostname: "abc123.trycloudflare.com",
    });
    expect(detectAgent()).toEqual({
      url: "wss://abc123.trycloudflare.com/ws",
      host: "abc123.trycloudflare.com",
      token: "hunter2",
    });
  });
});

// ---- WebSocket-backed Connection behavior ----

class FakeWebSocket {
  static OPEN = 1;
  static mode: "open" | "error" = "open";
  // When true every socket opens and then immediately drops — a flapping agent
  // (proxy up, backend down / crashing right after the upgrade).
  static flap = false;
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
        // Drop a tick after opening — after connect() has resolved and the
        // Connection has adopted this socket as its live transport.
        if (FakeWebSocket.flap) setTimeout(() => this.drop(), 1);
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

// Minimal Web Bluetooth device stand-in: drives the GATT chain and lets a test
// fire a gattserverdisconnected event.
function fakeBleDevice() {
  const listeners: Record<string, Array<() => void>> = {};
  const char = { writeValue: vi.fn(async () => {}) };
  const gatt = {
    connected: true,
    connect: vi.fn(async () => ({
      getPrimaryService: async () => ({ getCharacteristic: async () => char }),
    })),
    disconnect: vi.fn(() => {
      gatt.connected = false;
    }),
  };
  return {
    gatt,
    char,
    addEventListener: (t: string, fn: () => void) => {
      (listeners[t] ||= []).push(fn);
    },
    removeEventListener: (t: string, fn: () => void) => {
      listeners[t] = (listeners[t] || []).filter((f) => f !== fn);
    },
    emit: (t: string) => (listeners[t] || []).forEach((f) => f()),
  };
}

describe("Connection", () => {
  beforeEach(() => {
    FakeWebSocket.mode = "open";
    FakeWebSocket.flap = false;
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
    c.close();
  });

  it("stops notifying after unsubscribe", async () => {
    const c = new Connection();
    const seen: string[] = [];
    const off = c.onState((s) => seen.push(s));
    off();
    await c.pair({ url: "ws://10.0.0.2/ws", host: "x" });
    expect(seen).toEqual([]);
    c.close();
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
    c.close();
  });

  it("classifies a tunnel url as 'tunnel'", async () => {
    const c = new Connection();
    await c.pair({ url: "wss://abc123.trycloudflare.com/ws", host: "Tunnelled" });
    expect(c.transport?.kind).toBe("tunnel");
    c.close();
  });

  it("carries the pairing token on the socket URL as ?t=", async () => {
    const c = new Connection();
    await c.pair({ url: "ws://192.168.1.9/ws", host: "x", token: "s3cr3t" });
    expect(FakeWebSocket.last!.url).toBe("ws://192.168.1.9/ws?t=s3cr3t");
    c.close();
  });

  it("appends the token with & when the url already carries a query", async () => {
    const c = new Connection();
    await c.pair({ url: "ws://192.168.1.9/ws?x=1", host: "x", token: "tok" });
    expect(FakeWebSocket.last!.url).toBe("ws://192.168.1.9/ws?x=1&t=tok");
    c.close();
  });

  it("connects without a token when none is provided", async () => {
    const c = new Connection();
    await c.pair({ url: "ws://192.168.1.9/ws", host: "x" });
    expect(FakeWebSocket.last!.url).toBe("ws://192.168.1.9/ws");
    c.close();
  });

  it("re-applies the token to the socket after an auto-reconnect", async () => {
    vi.useFakeTimers();
    try {
      const c = new Connection();
      const pairing = c.pair({ url: "ws://192.168.1.9/ws", host: "x", token: "S3C" });
      await vi.advanceTimersByTimeAsync(1);
      await pairing;
      expect(FakeWebSocket.last!.url).toBe("ws://192.168.1.9/ws?t=S3C");

      FakeWebSocket.last!.drop();
      await vi.advanceTimersByTimeAsync(600); // backoff elapses, new socket opens
      expect(c.state).toBe("live");
      expect(FakeWebSocket.last!.url).toBe("ws://192.168.1.9/ws?t=S3C"); // token survived the reconnect
      c.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("updates host/os when the server sends a 'hello' frame", async () => {
    const c = new Connection();
    await c.pair({ url: "ws://192.168.1.9/ws", host: "DevBox", os: "mac" });
    FakeWebSocket.last!.onmessage!({
      data: JSON.stringify({ v: 1, t: "hello", d: { host: "Renamed-Mac", os: "win", version: "9" } }),
    });
    expect(c.host).toBe("Renamed-Mac");
    expect(c.os).toBe("win");
    c.close();
  });

  it("ignores a non-JSON server message without throwing or dropping the link", async () => {
    const c = new Connection();
    await c.pair({ url: "ws://192.168.1.9/ws", host: "DevBox" });
    expect(() => FakeWebSocket.last!.onmessage!({ data: "not json{" })).not.toThrow();
    expect(c.state).toBe("live");
    c.close();
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

  it("a dropped link immediately stops reading 'live' so taps can't silently vanish", async () => {
    const c = new Connection();
    await c.pair({ url: "ws://192.168.1.9/ws", host: "DevBox" });
    expect(c.state).toBe("live");

    // Agent quits / Mac sleeps / tunnel idles out — the socket closes on its own.
    FakeWebSocket.last!.drop();

    expect(c.state).not.toBe("live"); // -> "connecting" (auto-reconnecting)
    expect(c.transport).toBeNull();
    expect(c.fire({ mods: [], key: "x" })).toBe(false); // no silent no-op tap
    c.close(); // cancel the pending reconnect timer so the test leaves nothing running
    expect(c.state).toBe("idle");
  });

  it("close() during an in-flight connect() does not resurrect the socket", async () => {
    const c = new Connection();
    const pairing = c.pair({ url: "ws://192.168.1.9/ws", host: "x" });
    // Tear down before the fake socket's async onopen fires.
    c.close();
    const ok = await pairing; // the superseded connect resolves into a dead epoch
    expect(ok).toBe(false);
    expect(c.state).toBe("idle"); // not resurrected to "live"
    expect(c.transport).toBeNull();
    expect(FakeWebSocket.last!.closed).toBe(true); // the orphaned socket was closed
  });

  it("a failed manual pair does not arm auto-reconnect (retry stays a no-op)", async () => {
    FakeWebSocket.mode = "error";
    const c = new Connection();
    expect(await c.pair({ url: "wss://typo.example/ws", host: "x" })).toBe(false);
    expect(c.state).toBe("error");
    // wantUrl was never remembered, so an auto-wake / manual retry can't reopen
    // the URL the contract promised never to retry.
    expect(await c.retry()).toBe(false);
  });

  it("ignores a 'hello' buffered on a socket after we've torn it down", async () => {
    const c = new Connection();
    await c.pair({ url: "ws://192.168.1.9/ws", host: "Original" });
    const ws = FakeWebSocket.last!;
    c.close();
    ws.onmessage!({
      data: JSON.stringify({ v: 1, t: "hello", d: { host: "Ghost", os: "win", version: "9" } }),
    });
    expect(c.host).toBe("Original"); // the orphaned socket can't rename the machine
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

  it("auto-reconnects after an unexpected drop (sleep/wake, tunnel re-establish)", async () => {
    vi.useFakeTimers();
    try {
      const c = new Connection();
      const seen: string[] = [];
      c.onState((s) => seen.push(s));

      const pairing = c.pair({ url: "ws://192.168.1.9/ws", host: "DevBox" });
      await vi.advanceTimersByTimeAsync(1); // fake socket opens
      await pairing;
      expect(c.state).toBe("live");

      FakeWebSocket.last!.drop(); // link vanishes
      expect(c.state).toBe("connecting"); // not "error" — it's retrying

      await vi.advanceTimersByTimeAsync(600); // backoff elapses, new socket opens
      expect(c.state).toBe("live");
      expect(c.fire({ mods: ["MOD"], key: "c" })).toBe(true); // taps work again
      expect(seen).toEqual(["connecting", "live", "connecting", "live"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up with an error after exhausting reconnect attempts", async () => {
    vi.useFakeTimers();
    try {
      const c = new Connection();
      const pairing = c.pair({ url: "ws://192.168.1.9/ws", host: "DevBox" });
      await vi.advanceTimersByTimeAsync(1);
      await pairing;
      expect(c.state).toBe("live");

      FakeWebSocket.mode = "error"; // agent is truly gone; every retry fails
      FakeWebSocket.last!.drop();
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000); // run through all backoffs

      expect(c.state).toBe("error");
      expect(c.lastError).toMatch(/lost/i);
      expect(c.fire({ mods: [], key: "x" })).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("escalates backoff for a flapping agent and finally settles on error", async () => {
    vi.useFakeTimers();
    try {
      // Every socket opens then immediately drops. The OLD code reset the backoff on
      // each open, so this looped forever at the 500ms floor and never gave up.
      FakeWebSocket.flap = true;
      const c = new Connection();
      const pairing = c.pair({ url: "ws://10.0.0.9/ws", host: "x" });
      await vi.advanceTimersByTimeAsync(120_000); // run well past the full backoff budget
      await pairing;
      expect(c.state).toBe("error"); // escalated to give-up instead of a 500ms storm
    } finally {
      FakeWebSocket.flap = false;
      vi.useRealTimers();
    }
  });

  it("surfaces an agent error frame to onError + lastError without dropping the link", async () => {
    const c = new Connection();
    await c.pair({ url: "ws://192.168.1.9/ws", host: "DevBox" });
    const errors: string[] = [];
    const off = c.onError((m) => errors.push(m));

    FakeWebSocket.last!.onmessage!({
      data: JSON.stringify({ v: 1, t: "error", d: { message: "Accessibility permission denied" } }),
    });

    expect(errors).toEqual(["Accessibility permission denied"]);
    expect(c.lastError).toBe("Accessibility permission denied");
    expect(c.state).toBe("live"); // the socket is fine — only the injection failed
    off();
    c.close();
  });

  it("does not auto-reconnect after an intentional close()", async () => {
    vi.useFakeTimers();
    try {
      const c = new Connection();
      const pairing = c.pair({ url: "ws://192.168.1.9/ws", host: "DevBox" });
      await vi.advanceTimersByTimeAsync(1);
      await pairing;

      c.close();
      expect(c.state).toBe("idle");
      await vi.advanceTimersByTimeAsync(30_000);
      expect(c.state).toBe("idle"); // stayed down on purpose — no resurrection
    } finally {
      vi.useRealTimers();
    }
  });

  it("a failed initial pair errors out without scheduling reconnects (no typo storm)", async () => {
    vi.useFakeTimers();
    try {
      FakeWebSocket.mode = "error";
      const c = new Connection();
      const pairing = c.pair({ url: "wss://typo.example/ws", host: "x" });
      await vi.advanceTimersByTimeAsync(1);
      const ok = await pairing;

      expect(ok).toBe(false);
      expect(c.state).toBe("error");
      await vi.advanceTimersByTimeAsync(30_000);
      expect(c.state).toBe("error"); // manual failure never auto-retries
    } finally {
      vi.useRealTimers();
    }
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

  it("sends periodic heartbeat pings to keep an idle link warm", async () => {
    vi.useFakeTimers();
    try {
      const c = new Connection();
      const pairing = c.pair({ url: "ws://192.168.1.9/ws", host: "x" });
      await vi.advanceTimersByTimeAsync(1);
      await pairing;
      const ws = FakeWebSocket.last!;
      expect(ws.sent).toHaveLength(0); // nothing sent while truly idle...

      await vi.advanceTimersByTimeAsync(26_000); // ...until the heartbeat fires
      const pings = ws.sent.map((s) => JSON.parse(s)).filter((f) => f.t === "ping");
      expect(pings.length).toBeGreaterThanOrEqual(1);
      expect(c.state).toBe("live"); // a pending pong-wait doesn't drop us yet
      c.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a pong reply keeps the link alive indefinitely (no false teardown)", async () => {
    vi.useFakeTimers();
    try {
      const c = new Connection();
      const pairing = c.pair({ url: "ws://192.168.1.9/ws", host: "x" });
      await vi.advanceTimersByTimeAsync(1);
      await pairing;
      const ws = FakeWebSocket.last!;
      // Agent answers every ping with a pong (as the real agent does).
      const origSend = ws.send.bind(ws);
      ws.send = (data: string) => {
        origSend(data);
        if (JSON.parse(data).t === "ping") {
          ws.onmessage?.({ data: JSON.stringify({ v: 1, t: "pong" }) });
        }
      };

      await vi.advanceTimersByTimeAsync(120_000); // 2 minutes of idle heartbeating
      expect(c.state).toBe("live");
      expect(ws.closed).toBe(false);
      expect(FakeWebSocket.last).toBe(ws); // never had to reconnect
      c.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats a missing pong as a dead link and reconnects (zombie socket)", async () => {
    vi.useFakeTimers();
    try {
      const c = new Connection();
      const pairing = c.pair({ url: "ws://192.168.1.9/ws", host: "x" });
      await vi.advanceTimersByTimeAsync(1);
      await pairing;
      const first = FakeWebSocket.last!; // this socket will go silent (no pong)

      // ping at 25s, no pong, watchdog fires at 35s → force-close → reconnect.
      await vi.advanceTimersByTimeAsync(40_000);

      expect(first.closed).toBe(true); // the zombie was torn down
      expect(FakeWebSocket.last).not.toBe(first); // a fresh socket replaced it
      expect(c.state).toBe("live"); // and the deck is usable again
      c.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("retry() brings the link back after auto-reconnect has given up", async () => {
    vi.useFakeTimers();
    try {
      const c = new Connection();
      const pairing = c.pair({ url: "ws://192.168.1.9/ws", host: "x" });
      await vi.advanceTimersByTimeAsync(1);
      await pairing;

      FakeWebSocket.mode = "error"; // agent gone — exhaust the retry budget
      FakeWebSocket.last!.drop();
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      expect(c.state).toBe("error");

      FakeWebSocket.mode = "open"; // agent is back; user taps "Reconnect"
      const r = c.retry();
      await vi.advanceTimersByTimeAsync(1);
      expect(await r).toBe(true);
      expect(c.state).toBe("live");
      c.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("retry() is a no-op before anything was ever paired", async () => {
    const c = new Connection();
    expect(await c.retry()).toBe(false);
    expect(c.state).toBe("idle");
  });

  it("retry() reports already-live without opening a second socket", async () => {
    const c = new Connection();
    await c.pair({ url: "ws://192.168.1.9/ws", host: "x" });
    const ws = FakeWebSocket.last!;
    expect(await c.retry()).toBe(true);
    expect(FakeWebSocket.last).toBe(ws); // no redundant reconnect while healthy
    c.close();
  });

  it("reports bluetooth unsupported and refuses to pair over BLE in jsdom", async () => {
    const c = new Connection();
    expect(c.bluetoothSupported()).toBe(false);
    const ok = await c.pairBluetooth();
    expect(ok).toBe(false);
    expect(c.state).toBe("error");
    expect(c.lastError).toMatch(/bluetooth/i);
  });

  it("surfaces a BLE GATT disconnect the same way as a WS drop", async () => {
    const device = fakeBleDevice();
    vi.stubGlobal("navigator", { bluetooth: { requestDevice: async () => device } });
    const c = new Connection();
    expect(await c.pairBluetooth()).toBe(true);
    expect(c.state).toBe("live");

    device.emit("gattserverdisconnected"); // powered off / out of range
    expect(c.state).toBe("error"); // no longer falsely "live"
    expect(c.fire({ mods: [], key: "x" })).toBe(false); // taps don't silently vanish
  });

  it("tears down a live WebSocket when switching to Bluetooth (no orphaned socket)", async () => {
    const device = fakeBleDevice();
    vi.stubGlobal("navigator", { bluetooth: { requestDevice: async () => device } });
    const c = new Connection();
    await c.pair({ url: "ws://192.168.1.9/ws", host: "x" });
    const ws = FakeWebSocket.last!;
    expect(ws.closed).toBe(false);

    expect(await c.pairBluetooth()).toBe(true);
    expect(ws.closed).toBe(true); // old WS closed, not left authenticated and warm
    expect(c.transport?.kind).toBe("bluetooth");
    c.close();
  });

  it("an intentional BLE close() doesn't report a drop and disconnects GATT", async () => {
    const device = fakeBleDevice();
    vi.stubGlobal("navigator", { bluetooth: { requestDevice: async () => device } });
    const c = new Connection();
    await c.pairBluetooth();
    const seen: string[] = [];
    c.onState((s) => seen.push(s));

    c.close();
    expect(c.state).toBe("idle");
    expect(device.gatt.disconnect).toHaveBeenCalled();
    device.emit("gattserverdisconnected"); // a late self-disconnect must not resurrect "error"
    expect(c.state).toBe("idle");
    expect(seen).toEqual(["idle"]);
  });
});

describe("bindAutoWake", () => {
  it("retries when the tab becomes visible again", () => {
    const c = new Connection();
    const spy = vi.spyOn(c, "retry").mockResolvedValue(true);
    const off = bindAutoWake(c);
    document.dispatchEvent(new Event("visibilitychange")); // jsdom defaults to "visible"
    expect(spy).toHaveBeenCalledTimes(1);
    off();
  });

  it("retries when the network comes back online", () => {
    const c = new Connection();
    const spy = vi.spyOn(c, "retry").mockResolvedValue(true);
    const off = bindAutoWake(c);
    window.dispatchEvent(new Event("online"));
    expect(spy).toHaveBeenCalledTimes(1);
    off();
  });

  it("stops listening after its cleanup runs", () => {
    const c = new Connection();
    const spy = vi.spyOn(c, "retry").mockResolvedValue(true);
    const off = bindAutoWake(c);
    off();
    window.dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(spy).not.toHaveBeenCalled();
  });
});

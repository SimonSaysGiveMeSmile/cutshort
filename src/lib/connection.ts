// Transport layer
// ----------------
// The phone needs to get a combo to the desktop agent. Which pipe wins (LAN
// WebSocket, Cloudflare tunnel, Web Bluetooth) is decided by real latency, so
// everything sits behind one `Transport` interface. There is no demo path:
// connecting means a real agent is on the other end injecting real keystrokes.
//
// Wire protocol (matches agent/src/index.js):
//   client -> { v:1, t:"key",  d:{ mods, key, os } } | { v:1, t:"ping" }
//   server -> { v:1, t:"hello", d:{ host, os, version } } | "ack" | "pong" | "error"

import type { Combo, OS } from "../shortcuts";
import { RttWindow, pickFastest, type TransportKind, type TransportLatency } from "./latency";

export type ConnState = "idle" | "connecting" | "live" | "error";

export interface KeyFrame {
  v: 1;
  t: "key";
  d: { mods: string[]; key: string; os: OS };
}

export type ServerFrame =
  | { v: 1; t: "hello"; d: { host: string; os: OS; version: string } }
  | { v: 1; t: "ack"; d: { combo: string } }
  | { v: 1; t: "pong" }
  | { v: 1; t: "error"; d: { message: string } };

export interface Transport {
  readonly kind: "lan" | "tunnel" | "bluetooth";
  connect(): Promise<void>;
  send(frame: KeyFrame): void;
  close(): void;
  onFrame?: (f: ServerFrame) => void;
  /** Fired when the link drops on its own (not via close()) after going live. */
  onClose?: () => void;
  /**
   * Fired with a round-trip time in milliseconds each time a ping is answered.
   * Feeds the transport latency A/B (see latency.ts) — a transport that has no
   * ping/pong just never calls it, and pickFastest() ignores the empty entry.
   */
  onRtt?: (ms: number) => void;
}

export interface Pairing {
  url: string; // ws(s):// or http(s):// endpoint (we normalize to ws)
  host?: string;
  os?: OS;
  token?: string;
}

/** Parse a pairing URL/string (manual paste or cutshort:// deep link). */
export function parsePairing(raw: string): Pairing | null {
  const text = raw.trim();
  if (!text) return null;
  try {
    // Normalize every input (http/https/ws/wss/cutshort) through the same
    // pipeline so the resulting url always points at the agent's /ws endpoint.
    // Query params (host/os/t) are lifted into the Pairing and dropped from the
    // url; the token is re-applied to the socket URL at connect time.
    const httpish = text.replace(/^cutshort:\/\//, "https://");
    const u = new URL(httpish);
    // Validate os against the known set rather than blind-casting: this value comes
    // from an untrusted deep link and drives which modifier glyphs/variants the deck
    // renders, so a stray `?os=linux` must fall back to undefined, not poison the UI.
    const osParam = u.searchParams.get("os");
    return {
      url: toWs(httpish),
      host: u.searchParams.get("host") ?? u.hostname,
      os: osParam === "mac" || osParam === "win" ? osParam : undefined,
      token: u.searchParams.get("t") ?? undefined,
    };
  } catch {
    return null;
  }
}

function toWs(url: string): string {
  // Normalize any origin to its ws(s):// /ws endpoint, preserving TLS for both
  // https:// and wss:// inputs (a bare wss:// paste must not be downgraded).
  const u = new URL(url);
  const secure = u.protocol === "https:" || u.protocol === "wss:";
  const proto = secure ? "wss:" : "ws:";
  const pathHasWs = u.pathname.endsWith("/ws");
  return `${proto}//${u.host}${pathHasWs ? u.pathname : "/ws"}`;
}

/** Append a query param to a (possibly already query-bearing) URL. */
function appendQuery(url: string, key: string, value: string): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}${key}=${encodeURIComponent(value)}`;
}

/**
 * Auto-detect the agent endpoint:
 *   1. `#connect=<url>` hash (set when scanning the agent's QR into the hosted app)
 *   2. served BY the agent itself (any origin that isn't the Vercel host or the
 *      Vite dev server) → same-origin /ws
 * Returns null when there's nothing to auto-connect to (show the connect screen).
 */
export function detectAgent(): Pairing | null {
  if (typeof location === "undefined") return null;
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  const c = hash.get("connect");
  if (c) return parsePairing(c);

  const host = location.host;
  const isHosted = /(\.vercel\.app$)|(cutshort\.online$)/.test(host);
  // Match the dev server on ANY port, not just 5173: Vite auto-increments (5174,
  // 5175, …) when the configured port is taken, and a hardcoded 5173 would make
  // those origins look like a same-origin agent and auto-connect to a ws:// that
  // no agent is serving — a spurious connect error on every dev reload.
  const isViteDev = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  if (!isHosted && !isViteDev && host) {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    // The agent puts the pairing token in the QR's URL fragment (#t=…) so the
    // same-origin deck can read it without it ever hitting the server logs.
    const token = hash.get("t") ?? undefined;
    const p: Pairing = { url: `${proto}//${host}/ws`, host: location.hostname };
    if (token) p.token = token;
    return p;
  }
  return null;
}

/** WebSocket transport — identical code path for LAN and tunnel. */
class WsTransport implements Transport {
  readonly kind: "lan" | "tunnel";
  onFrame?: (f: ServerFrame) => void;
  onClose?: () => void;
  onRtt?: (ms: number) => void;
  private ws: WebSocket | null = null;
  private url: string;
  private opened = false;
  private closedByUs = false;
  // When the outstanding heartbeat ping was sent, so the matching pong yields an
  // RTT sample for the latency A/B. 0 = no ping awaiting a pong.
  private pingSentAt = 0;
  // Heartbeat: a Cloudflare Quick Tunnel drops a WebSocket after ~100s idle, so
  // we ping well under that to keep an unused deck warm. The ping doubles as a
  // liveness probe — if the agent doesn't pong back in time the socket is a
  // zombie (e.g. the phone switched WiFi↔cellular), so we force it closed, which
  // trips onclose → reconnect far faster than the OS would notice.
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly PING_INTERVAL_MS = 25_000;
  private static readonly PONG_TIMEOUT_MS = 10_000;

  constructor(url: string, kind: "lan" | "tunnel", token?: string) {
    // The agent authenticates the upgrade by the ?t= token, so carry it on the
    // socket URL itself (works for same-origin, LAN paste, and tunnel alike).
    this.url = token ? appendQuery(url, "t", token) : url;
    this.kind = kind;
  }

  connect() {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.url);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error("timeout"));
      }, 5000);
      ws.onopen = () => {
        clearTimeout(timer);
        this.ws = ws;
        this.opened = true;
        this.startHeartbeat();
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(timer);
        // A failure before we ever opened is the connect() rejection; once
        // live, errors arrive as a close (handled below) — don't double-report.
        if (!this.opened) reject(new Error("ws error"));
      };
      ws.onclose = () => {
        clearTimeout(timer);
        this.stopHeartbeat();
        this.ws = null;
        // Surface only an *unexpected* drop: one that happens after a successful
        // open and wasn't triggered by our own close(). A pre-open close is the
        // connect() rejection's job.
        if (this.opened && !this.closedByUs) this.onClose?.();
      };
      ws.onmessage = (ev) => {
        let frame: ServerFrame;
        try {
          frame = JSON.parse(ev.data);
        } catch {
          return; // ignore non-JSON
        }
        if (frame?.t === "pong") this.onPong();
        this.onFrame?.(frame);
      };
    });
  }

  send(frame: KeyFrame) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(frame));
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.pingTimer = setInterval(() => this.sendPing(), WsTransport.PING_INTERVAL_MS);
  }

  private sendPing() {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    // Arm the pong watchdog BEFORE sending so a synchronous reply still clears it.
    if (!this.pongTimer) {
      this.pongTimer = setTimeout(() => this.onPongTimeout(), WsTransport.PONG_TIMEOUT_MS);
    }
    // Stamp the send so the pong can be turned into an RTT sample. One ping is in
    // flight at a time (interval 25s >> pong timeout 10s), so a single stamp holds.
    this.pingSentAt = Date.now();
    this.ws.send(JSON.stringify({ v: 1, t: "ping" }));
  }

  private onPong() {
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
    if (this.pingSentAt) {
      this.onRtt?.(Date.now() - this.pingSentAt);
      this.pingSentAt = 0;
    }
  }

  private onPongTimeout() {
    this.pongTimer = null;
    // Dead/zombie link — close it so onclose fires and the Connection reconnects.
    // Deliberately NOT closedByUs: this IS an unexpected drop we want to recover.
    try {
      this.ws?.close();
    } catch {
      /* already gone */
    }
  }

  private stopHeartbeat() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  close() {
    this.closedByUs = true;
    this.stopHeartbeat();
    this.ws?.close();
    this.ws = null;
  }
}

/** Minimal shape of the Web Bluetooth bits we touch (not in default DOM types). */
interface BleCharacteristic {
  writeValue(v: BufferSource): Promise<void>;
  startNotifications(): Promise<BleCharacteristic>;
  addEventListener(type: "characteristicvaluechanged", fn: () => void): void;
  removeEventListener(type: "characteristicvaluechanged", fn: () => void): void;
  value?: DataView;
}
interface BleDevice {
  addEventListener(type: "gattserverdisconnected", fn: () => void): void;
  removeEventListener(type: "gattserverdisconnected", fn: () => void): void;
  gatt?: {
    connected: boolean;
    connect(): Promise<{
      getPrimaryService(s: string): Promise<{
        getCharacteristic(c: string): Promise<BleCharacteristic>;
      }>;
    }>;
    disconnect(): void;
  };
}

/**
 * Decode a GATT notification payload (a DataView of UTF-8 JSON) into a server
 * frame. Pure so it's testable without a BLE stack; returns null on any garbage
 * (partial write, non-JSON, or a shape that isn't a frame) rather than throwing
 * into the notification handler.
 */
export function decodeBleFrame(view: DataView): ServerFrame | null {
  try {
    const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    const frame = JSON.parse(new TextDecoder().decode(bytes));
    return frame && typeof frame.t === "string" ? (frame as ServerFrame) : null;
  } catch {
    return null;
  }
}

/** Web Bluetooth transport — a supplementary/offline path (GATT write + notify). */
class BluetoothTransport implements Transport {
  readonly kind = "bluetooth" as const;
  onFrame?: (f: ServerFrame) => void;
  onClose?: () => void;
  onRtt?: (ms: number) => void;
  private static SERVICE = "0000c45b-0000-1000-8000-00805f9b34fb";
  private static CHAR = "0000c45c-0000-1000-8000-00805f9b34fb";
  private char: BleCharacteristic | null = null;
  private device: BleDevice | null = null;
  private closedByUs = false;
  // A GATT drop (device powered off / out of range) is the BLE equivalent of a
  // socket close — surface it so the deck doesn't keep reading "live".
  private onDisconnect = () => {
    if (!this.closedByUs) this.onClose?.();
  };
  // A notification arrived: the characteristic's `value` now holds the frame the
  // agent pushed back (hello / ack / error). Without this, BLE was a blind pipe
  // that could never report a failed injection.
  private onNotify = () => {
    const v = this.char?.value;
    if (!v) return;
    const frame = decodeBleFrame(v);
    if (frame) this.onFrame?.(frame);
  };

  static supported() {
    return typeof navigator !== "undefined" && "bluetooth" in navigator;
  }

  async connect() {
    // @ts-expect-error - navigator.bluetooth is not in default lib.dom types
    const device: BleDevice = await navigator.bluetooth.requestDevice({
      filters: [{ services: [BluetoothTransport.SERVICE] }],
    });
    this.device = device;
    device.addEventListener("gattserverdisconnected", this.onDisconnect);
    const server = await device.gatt!.connect();
    const svc = await server.getPrimaryService(BluetoothTransport.SERVICE);
    this.char = await svc.getCharacteristic(BluetoothTransport.CHAR);
    // Subscribe to the return channel. Best-effort: a write-only characteristic
    // (no notify) still carries key frames — we just won't hear acks/errors back.
    try {
      await this.char.startNotifications();
      this.char.addEventListener("characteristicvaluechanged", this.onNotify);
    } catch {
      /* notify unsupported — writes still work */
    }
  }

  send(frame: KeyFrame) {
    // Fire-and-forget, but swallow the write rejection (device out of range mid-
    // tap) so it doesn't surface as an unhandled promise rejection; a genuine
    // drop arrives via gattserverdisconnected instead.
    this.char?.writeValue(new TextEncoder().encode(JSON.stringify(frame))).catch(() => {});
  }

  close() {
    this.closedByUs = true;
    try {
      this.char?.removeEventListener("characteristicvaluechanged", this.onNotify);
      this.device?.removeEventListener("gattserverdisconnected", this.onDisconnect);
      if (this.device?.gatt?.connected) this.device.gatt.disconnect();
    } catch {
      /* best-effort */
    }
    this.char = null;
    this.device = null;
  }
}

export class Connection {
  state: ConnState = "idle";
  transport: Transport | null = null;
  host = "";
  os: OS = "mac";
  lastError = "";
  // Auto-reconnect: remember the target so a dropped link (sleep/wake, tunnel
  // re-establish, brief network blip) can come back on its own, with capped
  // exponential backoff and a bounded attempt count so a truly-gone agent
  // eventually settles on "error" instead of retrying forever / draining battery.
  private wantUrl: Pairing | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  // When the current link went live. The backoff is only reset once a link has been
  // continuously live past STABLE_MS — otherwise an agent that accepts the upgrade
  // then immediately drops (proxy up but backend down, agent crashing right after
  // hello) would reset attempt on every open and loop forever at the 500ms floor,
  // never escalating to "error".
  private liveSince = 0;
  // Bumped on every pair/retry/reconnect/close. A connect() that resolves after
  // its epoch was superseded (e.g. close() or a fresh pair() ran mid-handshake)
  // tears itself down instead of resurrecting as the live transport.
  private epoch = 0;
  private static readonly MAX_BACKOFF_MS = 10_000;
  private static readonly MAX_ATTEMPTS = 8;
  // How long a link must stay live before a later drop is treated as a fresh
  // incident (backoff reset) rather than part of an escalating flap.
  private static readonly STABLE_MS = 10_000;
  private listeners = new Set<(s: ConnState) => void>();
  // Separate from state listeners: the agent can report a failed injection while the
  // socket stays live (state doesn't change), so the UI needs its own channel to
  // surface that instead of leaving the deck green while taps silently no-op.
  private errorListeners = new Set<(msg: string) => void>();
  // Recent RTT per transport kind, fed by each transport's ping/pong. This is the
  // raw material for the latency A/B: latencySummaries() collapses it and
  // fastestTransport() ranks it. Kept across a single kind's reconnects so a brief
  // blip doesn't wipe the sampled history.
  private rttWindows = new Map<TransportKind, RttWindow>();
  private rttListeners = new Set<(kind: TransportKind, ms: number) => void>();

  onState(fn: (s: ConnState) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  onError(fn: (msg: string) => void) {
    this.errorListeners.add(fn);
    return () => this.errorListeners.delete(fn);
  }
  onRtt(fn: (kind: TransportKind, ms: number) => void) {
    this.rttListeners.add(fn);
    return () => this.rttListeners.delete(fn);
  }

  /** Record an RTT sample from the live transport into its recent-window ring. */
  private recordRtt(t: Transport, ms: number) {
    if (t !== this.transport) return; // stale sample from a replaced socket
    let w = this.rttWindows.get(t.kind);
    if (!w) {
      w = new RttWindow();
      this.rttWindows.set(t.kind, w);
    }
    w.record(ms);
    this.rttListeners.forEach((l) => l(t.kind, ms));
  }

  /** Per-transport latency summaries for whichever kinds have samples. */
  latencySummaries(): TransportLatency[] {
    const out: TransportLatency[] = [];
    for (const [kind, w] of this.rttWindows) {
      const summary = w.summary();
      if (summary) out.push({ kind, summary });
    }
    return out;
  }

  /** The A/B verdict: which sampled transport is fastest (null until we have data). */
  fastestTransport(): TransportKind | null {
    return pickFastest(this.latencySummaries());
  }
  private set(s: ConnState) {
    this.state = s;
    this.listeners.forEach((l) => l(s));
  }

  bluetoothSupported() {
    return BluetoothTransport.supported();
  }

  /**
   * Connect to a real agent over WS. A *manual* pair (user-initiated): on
   * failure it errors out immediately and does NOT auto-retry, so a typo'd URL
   * can't spin up a reconnect storm. Once live, an unexpected drop DOES trigger
   * auto-reconnect (see onTransportClosed).
   */
  async pair(p: Pairing): Promise<boolean> {
    this.attempt = 0;
    return this.openTransport(p, /* manual */ true);
  }

  /**
   * Re-attempt the last target on demand — the escape hatch once auto-reconnect
   * has given up (e.g. the user reopens the laptop an hour later and taps the
   * "Reconnect" chip). No-op if we never paired or are already live / mid-retry;
   * resets the backoff so a deliberate retry starts fresh.
   */
  async retry(): Promise<boolean> {
    if (!this.wantUrl) return false;
    if (this.state === "live") return true;
    if (this.state === "connecting") return false; // a reconnect is already in flight
    this.attempt = 0;
    return this.openTransport(this.wantUrl, /* manual */ true);
  }

  private async openTransport(p: Pairing, manual: boolean): Promise<boolean> {
    this.clearReconnect();
    // Tear down any prior transport first so a re-pair (e.g. switching links
    // while live) can't leave an orphaned, still-authenticated socket beating in
    // the background. (No-op on the reconnect path, where it's already null.)
    this.transport?.close();
    this.transport = null;
    // A fresh pair to a *different* target starts a new latency A/B — don't let
    // one machine's RTTs blend into another's window. The auto-reconnect path
    // re-opens the same wantUrl (urls match), so a reconnect keeps its history.
    if (this.wantUrl && this.wantUrl.url !== p.url) this.rttWindows.clear();
    // scheduleReconnect() already moved us to "connecting" for the backoff wait;
    // don't re-emit the same state when the retry timer actually fires.
    if (this.state !== "connecting") this.set("connecting");
    this.host = p.host || this.host || "Machine";
    if (p.os) this.os = p.os;
    const myEpoch = ++this.epoch;
    const isLan = /\.local|192\.168\.|10\.|127\.0\.0\.1|localhost/.test(p.url);
    const t = new WsTransport(p.url, isLan ? "lan" : "tunnel", p.token);
    // Guard the callback so a hello buffered on an orphaned socket can't clobber
    // host/os or re-emit state after this transport has been replaced.
    t.onFrame = (f) => {
      if (t === this.transport) this.onServerFrame(f);
    };
    t.onClose = () => this.onTransportClosed(t);
    t.onRtt = (ms) => this.recordRtt(t, ms);
    try {
      await t.connect();
      // Superseded mid-handshake (close()/new pair() ran): don't go live, just
      // tear down the socket we just opened so it can't leak or keep beating.
      if (myEpoch !== this.epoch) {
        t.close();
        return false;
      }
      this.transport = t;
      // Don't reset the backoff here — opening isn't the same as staying up. The
      // reset happens in scheduleReconnect once the link proves stable (see
      // STABLE_MS), so a flapping agent keeps escalating instead of looping.
      this.liveSince = Date.now();
      this.wantUrl = p; // only remember a target that actually connected
      this.set("live");
      return true;
    } catch (e) {
      if (myEpoch !== this.epoch) return false; // superseded — stay quiet
      this.lastError = (e as Error).message;
      this.transport = null;
      if (manual) {
        this.set("error"); // user-initiated failure: surface it, don't loop
        return false;
      }
      this.scheduleReconnect(); // a reconnect attempt failed — back off and retry
      return false;
    }
  }

  async pairBluetooth(): Promise<boolean> {
    this.wantUrl = null; // BLE isn't auto-reconnected; drop any pending WS retry
    this.clearReconnect();
    this.transport?.close(); // don't leave a live WS socket warm when switching to BLE
    this.transport = null;
    const myEpoch = ++this.epoch;
    if (!BluetoothTransport.supported()) {
      this.lastError = "Web Bluetooth not supported on this device";
      this.set("error");
      return false;
    }
    this.set("connecting");
    const t = new BluetoothTransport();
    t.onFrame = (f) => {
      if (t === this.transport) this.onServerFrame(f);
    };
    t.onClose = () => this.onTransportClosed(t);
    t.onRtt = (ms) => this.recordRtt(t, ms);
    try {
      await t.connect();
      if (myEpoch !== this.epoch) {
        t.close();
        return false;
      }
      this.transport = t;
      this.host = "BLE Agent";
      this.set("live");
      return true;
    } catch (e) {
      if (myEpoch !== this.epoch) return false;
      this.lastError = (e as Error).message;
      this.set("error");
      return false;
    }
  }

  // The link vanished on its own — agent quit, Mac slept, or the tunnel idled
  // out. Without this the deck would still read "live" and every tap would
  // silently no-op (the closed socket just drops sends). We drop the dead
  // transport and try to bring the link back; only after exhausting the retry
  // budget do we settle on "error" (which the UI shows as "Offline").
  private onTransportClosed(t: Transport) {
    if (t !== this.transport) return; // stale callback from a replaced socket
    this.transport = null;
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    this.clearReconnect();
    // A link that had been stably live is a fresh incident (sleep/wake, tunnel
    // re-establish) — reset the backoff so recovery is quick. A link that dropped
    // right after opening (or never opened) keeps its escalating count so a flapping
    // agent settles on "error" instead of a perpetual 500ms reconnect loop.
    if (this.liveSince && Date.now() - this.liveSince >= Connection.STABLE_MS) {
      this.attempt = 0;
    }
    this.liveSince = 0;
    if (!this.wantUrl || this.attempt >= Connection.MAX_ATTEMPTS) {
      this.lastError = "Connection lost";
      this.set("error");
      return;
    }
    const delay = Math.min(Connection.MAX_BACKOFF_MS, 500 * 2 ** this.attempt);
    this.attempt++;
    this.lastError = "Connection lost — reconnecting…";
    this.set("connecting"); // UI keeps the user informed instead of faking "live"
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.wantUrl) this.openTransport(this.wantUrl, /* manual */ false);
    }, delay);
  }

  private clearReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private onServerFrame(f: ServerFrame) {
    // Optional-chain `d`: a hello/error frame that arrives without its payload
    // (truncated BLE notification, a hand-rolled/malformed agent) must degrade to
    // a default, not throw a TypeError out of the socket's onmessage / BLE notify
    // handler. Guards both transports since they share this handler.
    if (f.t === "hello") {
      this.host = f.d?.host || this.host;
      this.os = f.d?.os || this.os;
      // re-emit so the UI refreshes the machine name
      this.set(this.state);
    } else if (f.t === "error") {
      // The agent injected nothing (e.g. macOS Accessibility permission was revoked
      // while live, or nut.js threw). The socket is fine, so state stays "live" — but
      // we must tell the user their tap didn't land instead of silently confirming it.
      this.lastError = f.d?.message || "Agent error";
      this.errorListeners.forEach((l) => l(this.lastError));
    }
  }

  fire(combo: Combo): boolean {
    if (!this.transport || this.state !== "live") return false;
    this.transport.send({
      v: 1,
      t: "key",
      d: { mods: combo.mods, key: combo.key, os: this.os },
    });
    return true;
  }

  close() {
    this.epoch++; // supersede any in-flight connect so it tears itself down
    this.wantUrl = null; // intentional teardown — stop auto-reconnecting
    this.liveSince = 0;
    this.clearReconnect();
    this.transport?.close();
    this.transport = null;
    this.rttWindows.clear(); // new session: don't inherit a prior link's RTTs
    this.set("idle");
  }
}

export const connection = new Connection();

/**
 * Wire the "I'm back" signals — the tab becoming visible again (phone unlocked,
 * app foregrounded) and the network returning — to a reconnect. retry() is a
 * no-op unless we're paired and currently offline, so this is safe to bind once
 * at startup regardless of screen. Returns a cleanup function.
 */
export function bindAutoWake(conn: Connection = connection): () => void {
  if (typeof document === "undefined") return () => {};
  const onVisible = () => {
    if (document.visibilityState === "visible") conn.retry();
  };
  const onOnline = () => conn.retry();
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("online", onOnline);
  return () => {
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("online", onOnline);
  };
}

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

export type ConnState = "idle" | "connecting" | "live" | "error";

export interface KeyFrame {
  v: 1;
  t: "key";
  d: { mods: string[]; key: string; os: OS };
}

type ServerFrame =
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
    const u = new URL(text.replace(/^cutshort:\/\//, "https://"));
    const wsUrl = text.startsWith("cutshort://")
      ? text.replace(/^cutshort:\/\//, "wss://")
      : toWs(text);
    return {
      url: wsUrl,
      host: u.searchParams.get("host") ?? u.hostname,
      os: (u.searchParams.get("os") as OS) ?? undefined,
      token: u.searchParams.get("t") ?? undefined,
    };
  } catch {
    return null;
  }
}

function toWs(url: string): string {
  // Normalize an http(s):// origin to its ws(s):// /ws endpoint.
  const u = new URL(url);
  const proto = u.protocol === "https:" ? "wss:" : "ws:";
  const pathHasWs = u.pathname.endsWith("/ws");
  return `${proto}//${u.host}${pathHasWs ? u.pathname : "/ws"}`;
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
  const isViteDev = /^localhost:5173$|^127\.0\.0\.1:5173$/.test(host);
  if (!isHosted && !isViteDev && host) {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return { url: `${proto}//${host}/ws`, host: location.hostname };
  }
  return null;
}

/** WebSocket transport — identical code path for LAN and tunnel. */
class WsTransport implements Transport {
  readonly kind: "lan" | "tunnel";
  onFrame?: (f: ServerFrame) => void;
  onClose?: () => void;
  private ws: WebSocket | null = null;
  private url: string;
  private opened = false;
  private closedByUs = false;

  constructor(url: string, kind: "lan" | "tunnel") {
    this.url = url;
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
        this.ws = null;
        // Surface only an *unexpected* drop: one that happens after a successful
        // open and wasn't triggered by our own close(). A pre-open close is the
        // connect() rejection's job.
        if (this.opened && !this.closedByUs) this.onClose?.();
      };
      ws.onmessage = (ev) => {
        try {
          this.onFrame?.(JSON.parse(ev.data));
        } catch {
          /* ignore non-JSON */
        }
      };
    });
  }

  send(frame: KeyFrame) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(frame));
  }

  close() {
    this.closedByUs = true;
    this.ws?.close();
    this.ws = null;
  }
}

/** Web Bluetooth transport — a supplementary/offline path (GATT write). */
class BluetoothTransport implements Transport {
  readonly kind = "bluetooth" as const;
  private static SERVICE = "0000c45b-0000-1000-8000-00805f9b34fb";
  private static CHAR = "0000c45c-0000-1000-8000-00805f9b34fb";
  private char: { writeValue(v: BufferSource): Promise<void> } | null = null;

  static supported() {
    return typeof navigator !== "undefined" && "bluetooth" in navigator;
  }

  async connect() {
    // @ts-expect-error - navigator.bluetooth is not in default lib.dom types
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [BluetoothTransport.SERVICE] }],
    });
    const server = await device.gatt.connect();
    const svc = await server.getPrimaryService(BluetoothTransport.SERVICE);
    this.char = await svc.getCharacteristic(BluetoothTransport.CHAR);
  }

  send(frame: KeyFrame) {
    this.char?.writeValue(new TextEncoder().encode(JSON.stringify(frame)));
  }

  close() {
    this.char = null;
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
  private static readonly MAX_BACKOFF_MS = 10_000;
  private static readonly MAX_ATTEMPTS = 8;
  private listeners = new Set<(s: ConnState) => void>();

  onState(fn: (s: ConnState) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
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
    this.wantUrl = p; // remember the target so drops can auto-reconnect
    this.attempt = 0;
    return this.openTransport(p, /* manual */ true);
  }

  private async openTransport(p: Pairing, manual: boolean): Promise<boolean> {
    this.clearReconnect();
    // scheduleReconnect() already moved us to "connecting" for the backoff wait;
    // don't re-emit the same state when the retry timer actually fires.
    if (this.state !== "connecting") this.set("connecting");
    this.host = p.host ?? this.host ?? "Machine";
    if (p.os) this.os = p.os;
    const isLan = /\.local|192\.168\.|10\.|127\.0\.0\.1|localhost/.test(p.url);
    const t = new WsTransport(p.url, isLan ? "lan" : "tunnel");
    t.onFrame = (f) => this.onServerFrame(f);
    t.onClose = () => this.onTransportClosed(t);
    try {
      await t.connect();
      this.transport = t;
      this.attempt = 0; // a good connection resets the backoff
      this.set("live");
      return true;
    } catch (e) {
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
    if (!BluetoothTransport.supported()) {
      this.lastError = "Web Bluetooth not supported on this device";
      this.set("error");
      return false;
    }
    this.set("connecting");
    const t = new BluetoothTransport();
    try {
      await t.connect();
      this.transport = t;
      this.host = "BLE Agent";
      this.set("live");
      return true;
    } catch (e) {
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
    if (f.t === "hello") {
      this.host = f.d.host || this.host;
      this.os = f.d.os || this.os;
      // re-emit so the UI refreshes the machine name
      this.set(this.state);
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
    this.wantUrl = null; // intentional teardown — stop auto-reconnecting
    this.clearReconnect();
    this.transport?.close();
    this.transport = null;
    this.set("idle");
  }
}

export const connection = new Connection();

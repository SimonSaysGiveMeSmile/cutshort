// Transport layer
// ----------------
// CutShort is transport-agnostic on purpose: the phone needs to get a combo to
// the desktop agent, and which pipe wins (LAN WebSocket, Cloudflare tunnel,
// Web Bluetooth) is to be decided by real-world latency tests. So we define a
// single `Transport` interface and ship three implementations behind it. The
// UI only ever talks to `Connection`.
//
// Wire protocol (mirrors soa-web's JSON-over-WS framing, swapping PTY for keys):
//   { v:1, t:"key",  d:{ mods:[...], key, os } }
//   { v:1, t:"ping" }                              -> { v:1, t:"pong" }
//   server -> client: { v:1, t:"hello", d:{ host, os } } | { v:1, t:"ack" }

import type { Combo, OS } from "../shortcuts";

export type ConnState = "idle" | "connecting" | "live" | "demo" | "error";

export interface KeyFrame {
  v: 1;
  t: "key";
  d: { mods: string[]; key: string; os: OS };
}

export interface Transport {
  readonly kind: "lan" | "tunnel" | "bluetooth" | "demo";
  connect(): Promise<void>;
  send(frame: KeyFrame): void;
  close(): void;
}

/** Parse a pairing URL/string scanned from the desktop QR. */
export interface Pairing {
  url: string; // ws(s):// or https:// endpoint
  host?: string; // friendly machine name
  os?: OS;
  token?: string; // single-use pairing token (signed cookie handshake on server)
}

export function parsePairing(raw: string): Pairing | null {
  const text = raw.trim();
  if (!text) return null;
  try {
    // Accept either a raw ws/http URL or a cutshort:// deep link.
    const u = new URL(text.replace(/^cutshort:\/\//, "https://"));
    return {
      url: text.startsWith("cutshort://")
        ? text.replace(/^cutshort:\/\//, "wss://")
        : text,
      host: u.searchParams.get("host") ?? u.hostname,
      os: (u.searchParams.get("os") as OS) ?? undefined,
      token: u.searchParams.get("t") ?? undefined,
    };
  } catch {
    return null;
  }
}

/** WebSocket transport — works over LAN and equally over a Cloudflare tunnel. */
class WsTransport implements Transport {
  readonly kind: "lan" | "tunnel";
  private ws: WebSocket | null = null;
  private url: string;

  constructor(url: string, kind: "lan" | "tunnel") {
    this.url = url;
    this.kind = kind;
  }

  connect() {
    return new Promise<void>((resolve, reject) => {
      const wsUrl = this.url.replace(/^http/, "ws");
      const ws = new WebSocket(wsUrl);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error("timeout"));
      }, 4000);
      ws.onopen = () => {
        clearTimeout(timer);
        this.ws = ws;
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error("ws error"));
      };
    });
  }

  send(frame: KeyFrame) {
    this.ws?.send(JSON.stringify(frame));
  }

  close() {
    this.ws?.close();
    this.ws = null;
  }
}

/**
 * Web Bluetooth transport — a supplementary/offline path. The desktop agent
 * exposes a GATT service with a writable "combo" characteristic; we serialize
 * the frame to bytes and write it. Guarded behind feature detection.
 */
class BluetoothTransport implements Transport {
  readonly kind = "bluetooth" as const;
  // CutShort GATT UUIDs (placeholder namespace — finalize with the agent build).
  private static SERVICE = "0000c45b-0000-1000-8000-00805f9b34fb";
  private static CHAR = "0000c45c-0000-1000-8000-00805f9b34fb";
  // Web Bluetooth types aren't in the default lib.dom; keep it loose.
  private char: { writeValue(v: BufferSource): Promise<void> } | null = null;

  static supported() {
    return typeof navigator !== "undefined" && "bluetooth" in navigator;
  }

  async connect() {
    // @ts-expect-error - navigator.bluetooth typing is optional lib.dom
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [BluetoothTransport.SERVICE] }],
    });
    const server = await device.gatt!.connect();
    const svc = await server.getPrimaryService(BluetoothTransport.SERVICE);
    this.char = await svc.getCharacteristic(BluetoothTransport.CHAR);
  }

  send(frame: KeyFrame) {
    if (!this.char) return;
    this.char.writeValue(new TextEncoder().encode(JSON.stringify(frame)));
  }

  close() {
    this.char = null;
  }
}

/** Demo transport — no backend. Logs frames so the UI is fully usable. */
class DemoTransport implements Transport {
  readonly kind = "demo" as const;
  connect() {
    return Promise.resolve();
  }
  send(frame: KeyFrame) {
    // eslint-disable-next-line no-console
    console.info("[cutshort demo] would fire →", frame.d);
  }
  close() {}
}

export class Connection {
  state: ConnState = "idle";
  transport: Transport = new DemoTransport();
  host = "Demo Machine";
  os: OS = "mac";
  private listeners = new Set<(s: ConnState) => void>();

  onState(fn: (s: ConnState) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private set(s: ConnState) {
    this.state = s;
    this.listeners.forEach((l) => l(s));
  }

  /** Try LAN/tunnel WS; fall back to demo so the deck always works. */
  async pair(p: Pairing) {
    this.set("connecting");
    this.host = p.host ?? "Machine";
    if (p.os) this.os = p.os;
    const isLan = /\.local|192\.168\.|10\.|127\.0\.0\.1|localhost/.test(p.url);
    const t = new WsTransport(p.url, isLan ? "lan" : "tunnel");
    try {
      await t.connect();
      this.transport = t;
      this.set("live");
    } catch {
      this.transport = new DemoTransport();
      this.set("demo");
    }
  }

  async pairBluetooth() {
    if (!BluetoothTransport.supported()) {
      this.set("error");
      return;
    }
    this.set("connecting");
    const t = new BluetoothTransport();
    try {
      await t.connect();
      this.transport = t;
      this.host = "BLE Agent";
      this.set("live");
    } catch {
      this.set("error");
    }
  }

  /** Enter the deck without a backend. */
  demo(os: OS = "mac") {
    this.transport = new DemoTransport();
    this.os = os;
    this.host = os === "mac" ? "Demo Mac" : "Demo PC";
    this.set("demo");
  }

  fire(combo: Combo) {
    this.transport.send({
      v: 1,
      t: "key",
      d: { mods: combo.mods, key: combo.key, os: this.os },
    });
  }

  close() {
    this.transport.close();
    this.set("idle");
  }
}

export const connection = new Connection();

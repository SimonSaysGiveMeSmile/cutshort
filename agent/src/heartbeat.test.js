import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { sweepAction, startHeartbeat } from "./heartbeat.js";

// A dead peer (phone off WiFi / backgrounded) leaves a half-open socket the OS may
// not reap for hours. The sweep terminates the ones that missed the last ping and
// pings the rest; the pure decision is the testable core.
describe("sweepAction", () => {
  it("terminates a socket that missed the previous ping (isAlive === false)", () => {
    expect(sweepAction(false)).toBe("terminate");
  });

  it("pings a socket that is alive or freshly connected", () => {
    expect(sweepAction(true)).toBe("ping");
    expect(sweepAction(undefined)).toBe("ping"); // brand-new socket, not yet swept
  });
});

// A WebSocketServer stand-in: a clients Set plus the "close" event, which is all
// startHeartbeat touches.
function fakeWss(clients) {
  const wss = new EventEmitter();
  wss.clients = new Set(clients);
  return wss;
}
function fakeSocket(isAlive) {
  return { isAlive, ping: vi.fn(), terminate: vi.fn() };
}

describe("startHeartbeat", () => {
  it("pings live sockets and marks them pending until the next pong", () => {
    const live = fakeSocket(true);
    const wss = fakeWss([live]);
    startHeartbeat(wss, { intervalMs: 100, setInterval: (fn) => fn(), clearInterval: () => {} });
    expect(live.ping).toHaveBeenCalledTimes(1);
    expect(live.isAlive).toBe(false); // cleared; the browser's pong must flip it back
    expect(live.terminate).not.toHaveBeenCalled();
  });

  it("terminates a socket that never ponged the previous ping", () => {
    const dead = fakeSocket(false);
    const wss = fakeWss([dead]);
    startHeartbeat(wss, { intervalMs: 100, setInterval: (fn) => fn(), clearInterval: () => {} });
    expect(dead.terminate).toHaveBeenCalledTimes(1);
    expect(dead.ping).not.toHaveBeenCalled();
  });

  it("clears the interval when the server closes", () => {
    const wss = fakeWss([]);
    const clearInterval = vi.fn();
    startHeartbeat(wss, { intervalMs: 100, setInterval: () => 42, clearInterval });
    wss.emit("close");
    expect(clearInterval).toHaveBeenCalledWith(42);
  });
});

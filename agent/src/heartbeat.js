// WebSocket liveness sweep
// ------------------------
// The agent injects keystrokes for a paired phone over a long-lived socket. When
// the phone vanishes without a close frame (drops off WiFi, backgrounds, switches
// WiFi↔cellular) the server-side socket has no peer but stays ESTABLISHED in
// `wss.clients` until the OS TCP timeout — which can be hours, or never. Reconnects
// then spawn fresh sockets while the dead ones leak, slowly exhausting file
// descriptors on a daemon meant to run for days.
//
// Standard remedy: each sweep, terminate any socket that didn't answer the
// previous protocol-level ping, then ping the rest. The browser answers a WS ping
// automatically with a pong, which flips isAlive back to true. The decision is a
// pure function so it's unit-testable without a real socket.

/** What to do with a socket this sweep: it's dead if it never ponged the last ping. */
export function sweepAction(isAlive) {
  return isAlive === false ? "terminate" : "ping";
}

/**
 * Start the liveness sweep over a WebSocketServer's clients. Marks each new-looking
 * socket as needing a pong, terminates the ones that missed the previous ping, and
 * re-arms the rest. Returns a stop() that clears the interval. setInterval/
 * clearInterval are injectable so the loop is testable with fake timers.
 */
export function startHeartbeat(
  wss,
  { intervalMs = 30_000, setInterval: si = setInterval, clearInterval: ci = clearInterval } = {},
) {
  const timer = si(() => {
    for (const ws of wss.clients) {
      if (sweepAction(ws.isAlive) === "terminate") {
        try {
          ws.terminate();
        } catch {
          /* already gone */
        }
        continue;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch {
        /* socket closing mid-sweep — the next pass terminates it */
      }
    }
  }, intervalMs);
  const stop = () => ci(timer);
  wss.on("close", stop);
  return stop;
}

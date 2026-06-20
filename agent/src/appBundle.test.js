import { describe, it, expect } from "vitest";
import { pidAlive } from "./appBundle.js";

// stopRunning() used to SIGTERM whatever pid was in the (possibly stale) pid
// file. pidAlive gates that so a recycled pid belonging to an unrelated process
// is never signalled.
describe("pidAlive", () => {
  it("is true for the current process", () => {
    expect(pidAlive(process.pid)).toBe(true);
  });

  it("is false for a pid that cannot exist", () => {
    expect(pidAlive(2147483647)).toBe(false); // max int pid, not in use
  });

  it("is false for non-positive / garbage pids", () => {
    expect(pidAlive(0)).toBe(false);
    expect(pidAlive(-1)).toBe(false);
    expect(pidAlive(NaN)).toBe(false);
  });
});

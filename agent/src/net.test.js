import { describe, it, expect } from "vitest";
import { lanIPv4s } from "./net.js";

// This picks the LAN address shown in the QR, so getting it wrong reads as
// "can't connect on the same WiFi". The family check guards a real Node-version
// quirk (string "IPv4" on older Node, number 4 on newer).
describe("lanIPv4s", () => {
  it("returns non-internal IPv4 addresses (older Node: family === 'IPv4')", () => {
    const ifaces = {
      lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
      en0: [
        { address: "192.168.1.20", family: "IPv4", internal: false },
        { address: "fe80::1", family: "IPv6", internal: false },
      ],
    };
    expect(lanIPv4s(ifaces)).toEqual(["192.168.1.20"]);
  });

  it("accepts the numeric family of newer Node (family === 4)", () => {
    const ifaces = { en0: [{ address: "10.0.0.5", family: 4, internal: false }] };
    expect(lanIPv4s(ifaces)).toEqual(["10.0.0.5"]);
  });

  it("collects addresses across multiple interfaces, preserving order", () => {
    const ifaces = {
      en0: [{ address: "192.168.1.20", family: 4, internal: false }],
      en1: [{ address: "192.168.1.21", family: 4, internal: false }],
    };
    expect(lanIPv4s(ifaces)).toEqual(["192.168.1.20", "192.168.1.21"]);
  });

  it("skips loopback / internal and IPv6, and tolerates empty input", () => {
    expect(lanIPv4s({})).toEqual([]);
    expect(lanIPv4s({ lo0: [{ address: "::1", family: 6, internal: true }] })).toEqual([]);
  });

  it("drops unroutable APIPA link-local (169.254.x.x) addresses", () => {
    const ifaces = {
      en0: [
        { address: "169.254.10.10", family: 4, internal: false },
        { address: "192.168.1.20", family: 4, internal: false },
      ],
    };
    expect(lanIPv4s(ifaces)).toEqual(["192.168.1.20"]);
  });

  it("orders the real WiFi adapter ahead of a Docker/VM bridge", () => {
    const ifaces = {
      bridge100: [{ address: "192.168.64.1", family: 4, internal: false }],
      en0: [{ address: "192.168.1.20", family: 4, internal: false }],
    };
    // [0] must be the reachable WiFi address, not the virtual bridge
    expect(lanIPv4s(ifaces)).toEqual(["192.168.1.20", "192.168.64.1"]);
  });

  it("deprioritizes a VPN (utun) address below the physical interface", () => {
    const ifaces = {
      utun3: [{ address: "10.99.0.2", family: 4, internal: false }],
      en0: [{ address: "192.168.1.20", family: 4, internal: false }],
    };
    expect(lanIPv4s(ifaces)).toEqual(["192.168.1.20", "10.99.0.2"]);
  });
});

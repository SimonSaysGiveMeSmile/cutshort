import { describe, it, expect } from "vitest";
import { parseInboundFrame } from "./frame.js";

describe("parseInboundFrame", () => {
  it("accepts a ping frame", () => {
    expect(parseInboundFrame(JSON.stringify({ v: 1, t: "ping" }))).toEqual({ t: "ping" });
  });

  it("accepts a key frame and passes its payload through", () => {
    const raw = JSON.stringify({ v: 1, t: "key", d: { mods: ["MOD"], key: "c", os: "mac" } });
    expect(parseInboundFrame(raw)).toEqual({ t: "key", d: { mods: ["MOD"], key: "c", os: "mac" } });
  });

  it("reads a Buffer payload, not just a string", () => {
    const buf = Buffer.from(JSON.stringify({ v: 1, t: "ping" }));
    expect(parseInboundFrame(buf)).toEqual({ t: "ping" });
  });

  it("ignores a JSON `null` payload instead of throwing (the old crash)", () => {
    // JSON.parse("null") === null; the old handler did null.t -> TypeError.
    expect(parseInboundFrame("null")).toBeNull();
  });

  it("ignores non-object top-level JSON (number / string / boolean / array)", () => {
    expect(parseInboundFrame("42")).toBeNull();
    expect(parseInboundFrame('"ping"')).toBeNull();
    expect(parseInboundFrame("true")).toBeNull();
    expect(parseInboundFrame("[1,2,3]")).toBeNull();
  });

  it("ignores non-JSON garbage", () => {
    expect(parseInboundFrame("not json{")).toBeNull();
    expect(parseInboundFrame("")).toBeNull();
  });

  it("rejects a key frame without a plain-object payload", () => {
    expect(parseInboundFrame(JSON.stringify({ v: 1, t: "key" }))).toBeNull();
    expect(parseInboundFrame(JSON.stringify({ v: 1, t: "key", d: null }))).toBeNull();
    expect(parseInboundFrame(JSON.stringify({ v: 1, t: "key", d: "MOD+c" }))).toBeNull();
    expect(parseInboundFrame(JSON.stringify({ v: 1, t: "key", d: ["MOD", "c"] }))).toBeNull();
  });

  it("ignores unknown frame types", () => {
    expect(parseInboundFrame(JSON.stringify({ v: 1, t: "hello" }))).toBeNull();
    expect(parseInboundFrame(JSON.stringify({ v: 1 }))).toBeNull();
  });
});

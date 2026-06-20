import { describe, it, expect } from "vitest";
import { generateToken, tokenFromUrl, tokensMatch, isLoopback } from "./auth.js";

describe("generateToken", () => {
  it("returns a non-empty URL-safe string", () => {
    const t = generateToken();
    expect(t.length).toBeGreaterThan(0);
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/); // base64url alphabet, no + / =
  });

  it("is unique across calls (not a constant)", () => {
    expect(generateToken()).not.toBe(generateToken());
  });
});

describe("tokenFromUrl", () => {
  it("reads ?t= from a bare request path", () => {
    expect(tokenFromUrl("/ws?t=abc123")).toBe("abc123");
  });

  it("reads ?t= alongside other params, in any position", () => {
    expect(tokenFromUrl("/ws?os=mac&t=tok&x=1")).toBe("tok");
  });

  it("returns null when there is no token", () => {
    expect(tokenFromUrl("/ws")).toBeNull();
    expect(tokenFromUrl("/")).toBeNull();
  });

  it("handles a fully-qualified URL", () => {
    expect(tokenFromUrl("http://host:8787/ws?t=zzz")).toBe("zzz");
  });

  it("returns null for garbage instead of throwing", () => {
    expect(tokenFromUrl(undefined)).toBeNull();
  });
});

describe("tokensMatch", () => {
  it("accepts an exact match", () => {
    expect(tokensMatch("s3cr3t-token", "s3cr3t-token")).toBe(true);
  });

  it("rejects a wrong token of the same length", () => {
    expect(tokensMatch("aaaaaa", "aaaaab")).toBe(false);
  });

  it("rejects a length mismatch", () => {
    expect(tokensMatch("short", "longer-token")).toBe(false);
  });

  it("rejects nullish / empty / non-string input", () => {
    expect(tokensMatch(null, "x")).toBe(false);
    expect(tokensMatch("x", undefined)).toBe(false);
    expect(tokensMatch("", "")).toBe(false);
    expect(tokensMatch(123, "123")).toBe(false);
  });

  it("round-trips a freshly generated token", () => {
    const t = generateToken();
    expect(tokensMatch(t, t)).toBe(true);
    expect(tokensMatch(t, generateToken())).toBe(false);
  });
});

describe("isLoopback", () => {
  it("recognizes IPv4, IPv6, and mapped loopback", () => {
    expect(isLoopback("127.0.0.1")).toBe(true);
    expect(isLoopback("::1")).toBe(true);
    expect(isLoopback("::ffff:127.0.0.1")).toBe(true);
  });

  it("rejects LAN and public addresses", () => {
    expect(isLoopback("192.168.1.9")).toBe(false);
    expect(isLoopback("10.0.0.4")).toBe(false);
    expect(isLoopback(undefined)).toBe(false);
  });
});

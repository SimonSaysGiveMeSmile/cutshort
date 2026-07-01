import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { loadOS, saveOS } from "./osPref";

describe("osPref", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults to mac when nothing is stored", () => {
    expect(loadOS()).toBe("mac");
  });

  it("round-trips a saved choice", () => {
    saveOS("win");
    expect(loadOS()).toBe("win");
    saveOS("mac");
    expect(loadOS()).toBe("mac");
  });

  it("ignores a garbage stored value and falls back to mac", () => {
    localStorage.setItem("cutshort.os", "linux");
    expect(loadOS()).toBe("mac");
  });

  it("falls back to mac (and doesn't throw) when localStorage access throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(loadOS()).toBe("mac");
    expect(() => saveOS("win")).not.toThrow(); // best-effort persist swallows it
  });
});

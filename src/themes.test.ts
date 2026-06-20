import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  THEMES,
  DEFAULT_THEME,
  loadTheme,
  loadMode,
  nativeMode,
  applyTheme,
  applyMode,
} from "./themes";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-mode");
  // paintMeta() looks for this element; recreate a clean one each test.
  document.head.innerHTML = '<meta name="theme-color" content="" />';
});

const metaColor = () =>
  document.querySelector('meta[name="theme-color"]')!.getAttribute("content");

describe("nativeMode", () => {
  it("returns dark for a dark theme and light for a light theme", () => {
    expect(nativeMode("neon")).toBe("dark"); // dark: true
    expect(nativeMode("liquid-glass")).toBe("light"); // dark: false
  });

  it("defaults to light for an unknown theme id", () => {
    expect(nativeMode("does-not-exist")).toBe("light");
  });
});

describe("loadTheme", () => {
  it("returns the default theme when nothing is saved", () => {
    expect(loadTheme()).toBe(DEFAULT_THEME);
  });

  it("returns a saved theme when it is a known id", () => {
    localStorage.setItem("cutshort.theme", "neon");
    expect(loadTheme()).toBe("neon");
  });

  it("falls back to the default when the saved id is unknown", () => {
    localStorage.setItem("cutshort.theme", "bogus-theme");
    expect(loadTheme()).toBe(DEFAULT_THEME);
  });
});

describe("loadMode", () => {
  it("follows the theme's native mode when no explicit mode is saved", () => {
    expect(loadMode("neon")).toBe("dark");
    expect(loadMode("liquid-glass")).toBe("light");
  });

  it("lets an explicitly saved mode win over the theme's native mode", () => {
    localStorage.setItem("cutshort.mode", "dark");
    expect(loadMode("liquid-glass")).toBe("dark"); // native light, override dark
    localStorage.setItem("cutshort.mode", "light");
    expect(loadMode("neon")).toBe("light"); // native dark, override light
  });

  it("ignores a garbage saved mode and uses native", () => {
    localStorage.setItem("cutshort.mode", "purple");
    expect(loadMode("neon")).toBe("dark");
  });
});

describe("storage access that throws", () => {
  it("falls back to defaults instead of crashing when getItem throws", () => {
    const spy = vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("SecurityError: storage blocked");
    });
    expect(loadTheme()).toBe(DEFAULT_THEME);
    expect(loadMode("neon")).toBe("dark"); // native mode of the dark theme
    spy.mockRestore();
  });
});

describe("applyTheme", () => {
  it("sets data-theme, resolves the mode, persists the theme, and paints meta", () => {
    applyTheme("neon"); // native dark, no saved mode
    expect(document.documentElement.getAttribute("data-theme")).toBe("neon");
    expect(document.documentElement.getAttribute("data-mode")).toBe("dark");
    expect(localStorage.getItem("cutshort.theme")).toBe("neon");
    expect(metaColor()).toBe("#06070a");
  });

  it("honors an explicit mode argument over the native mode", () => {
    applyTheme("neon", "light");
    expect(document.documentElement.getAttribute("data-mode")).toBe("light");
    expect(metaColor()).toBe("#f2f4f8");
  });
});

describe("applyMode", () => {
  it("sets data-mode, persists the mode, and paints the matching meta color", () => {
    applyMode("dark");
    expect(document.documentElement.getAttribute("data-mode")).toBe("dark");
    expect(localStorage.getItem("cutshort.mode")).toBe("dark");
    expect(metaColor()).toBe("#06070a");

    applyMode("light");
    expect(document.documentElement.getAttribute("data-mode")).toBe("light");
    expect(localStorage.getItem("cutshort.mode")).toBe("light");
    expect(metaColor()).toBe("#f2f4f8");
  });
});

describe("THEMES registry integrity", () => {
  it("has unique ids", () => {
    const ids = THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("includes the default theme", () => {
    expect(THEMES.some((t) => t.id === DEFAULT_THEME)).toBe(true);
  });

  it("gives every theme two swatch colors and required fields", () => {
    for (const t of THEMES) {
      expect(t.swatch).toHaveLength(2);
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.blurb.length).toBeGreaterThan(0);
      expect(typeof t.dark).toBe("boolean");
    }
  });
});

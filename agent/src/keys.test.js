import { describe, it, expect, vi } from "vitest";

// Mock nut.js so no real keystrokes fire and no native module loads.
// `Key` is a Proxy that echoes the property name, so Key.LeftCmd === "LeftCmd",
// Key.C === "C", Key.F5 === "F5", etc. — exactly the tokens keys.js looks up.
vi.mock("@nut-tree-fork/nut-js", () => {
  const Key = new Proxy(
    {},
    { get: (_t, prop) => (typeof prop === "string" ? prop : undefined) },
  );
  const keyboard = { config: {}, type: vi.fn(async () => {}) };
  return { keyboard, Key };
});

// keys.js freezes `isMac = process.platform === "darwin"` at module-eval time, so
// the platform must be set BEFORE import. load() owns that: it pins the platform,
// resets the module registry, imports a fresh keys.js + matching mock instance,
// then restores the platform. Each call is fully isolated — no reliance on test
// declaration order or import-cache state.
async function load(platform = "darwin") {
  const orig = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
  vi.resetModules();
  const nut = await import("@nut-tree-fork/nut-js");
  const keys = await import("./keys.js");
  if (orig) Object.defineProperty(process, "platform", orig);
  return { keyboard: nut.keyboard, injectCombo: keys.injectCombo };
}

describe("injectCombo — base key resolution", () => {
  it("maps a modifier + letter and returns a human label", async () => {
    const { keyboard, injectCombo } = await load();
    expect(await injectCombo({ mods: ["MOD"], key: "c" })).toBe("MOD+c");
    expect(keyboard.type).toHaveBeenCalledWith("LeftCmd", "C");
  });

  it("handles multiple modifiers in order", async () => {
    const { keyboard, injectCombo } = await load();
    expect(await injectCombo({ mods: ["MOD", "SHIFT"], key: "r" })).toBe("MOD+SHIFT+r");
    expect(keyboard.type).toHaveBeenCalledWith("LeftCmd", "LeftShift", "R");
  });

  it("defaults to no modifiers and maps Enter to the main Return key", async () => {
    const { keyboard, injectCombo } = await load();
    expect(await injectCombo({ key: "Enter" })).toBe("Enter");
    expect(keyboard.type).toHaveBeenCalledWith("Return"); // not numpad Enter
  });

  it("resolves the space key", async () => {
    const { keyboard, injectCombo } = await load();
    await injectCombo({ mods: ["MOD"], key: " " });
    expect(keyboard.type).toHaveBeenCalledWith("LeftCmd", "Space");
  });

  it("resolves a function key", async () => {
    const { keyboard, injectCombo } = await load();
    await injectCombo({ mods: ["MOD"], key: "F5" });
    expect(keyboard.type).toHaveBeenCalledWith("LeftCmd", "F5");
  });

  it("resolves a digit via the NUM map", async () => {
    const { keyboard, injectCombo } = await load();
    await injectCombo({ key: "5" });
    expect(keyboard.type).toHaveBeenCalledWith("Num5");
  });

  it("remaps arrow tokens to nut.js direction keys", async () => {
    const { keyboard, injectCombo } = await load();
    await injectCombo({ key: "ArrowUp" });
    expect(keyboard.type).toHaveBeenCalledWith("Up"); // "ArrowUp" -> Key.Up, not "ArrowUp"
  });

  it("resolves punctuation named keys", async () => {
    const { keyboard, injectCombo } = await load();
    await injectCombo({ mods: ["MOD"], key: "`" });
    expect(keyboard.type).toHaveBeenCalledWith("LeftCmd", "Grave");
  });

  it("resolves the common symbol keys editors bind", async () => {
    const { keyboard, injectCombo } = await load();
    const cases = [
      ["-", "Minus"],
      ["=", "Equal"],
      ["[", "LeftBracket"],
      ["]", "RightBracket"],
      [";", "Semicolon"],
      ["'", "Quote"],
    ];
    for (const [key, expected] of cases) {
      await injectCombo({ mods: ["MOD"], key });
      expect(keyboard.type).toHaveBeenLastCalledWith("LeftCmd", expected);
    }
  });

  it("resolves navigation keys", async () => {
    const { keyboard, injectCombo } = await load();
    for (const key of ["Home", "End", "PageUp", "PageDown", "Insert"]) {
      await injectCombo({ key });
      expect(keyboard.type).toHaveBeenLastCalledWith(key);
    }
  });

  it("resolves keys case-insensitively (matching the UI's free-form input)", async () => {
    const { keyboard, injectCombo } = await load();
    await injectCombo({ key: "f2" });
    expect(keyboard.type).toHaveBeenLastCalledWith("F2");
    await injectCombo({ key: "enter" });
    expect(keyboard.type).toHaveBeenLastCalledWith("Return");
    await injectCombo({ key: "home" });
    expect(keyboard.type).toHaveBeenLastCalledWith("Home");
  });
});

describe("injectCombo — modifier token mapping", () => {
  it("maps SHIFT / CTRL / ALT the same on every platform", async () => {
    const { keyboard, injectCombo } = await load();
    await injectCombo({ mods: ["CTRL"], key: "a" });
    expect(keyboard.type).toHaveBeenLastCalledWith("LeftControl", "A");
    await injectCombo({ mods: ["ALT"], key: "a" });
    expect(keyboard.type).toHaveBeenLastCalledWith("LeftAlt", "A");
  });

  it("maps MOD and SUPER to Cmd on macOS", async () => {
    const { keyboard, injectCombo } = await load("darwin");
    await injectCombo({ mods: ["MOD"], key: "a" });
    expect(keyboard.type).toHaveBeenLastCalledWith("LeftCmd", "A");
    await injectCombo({ mods: ["SUPER"], key: "a" });
    expect(keyboard.type).toHaveBeenLastCalledWith("LeftCmd", "A");
  });

  it("maps MOD to Control and SUPER to the Super key on Windows", async () => {
    const { keyboard, injectCombo } = await load("win32");
    await injectCombo({ mods: ["MOD"], key: "a" });
    expect(keyboard.type).toHaveBeenLastCalledWith("LeftControl", "A");
    await injectCombo({ mods: ["SUPER"], key: "a" });
    expect(keyboard.type).toHaveBeenLastCalledWith("LeftSuper", "A");
  });

  it("silently drops unknown modifier tokens but keeps them in the label", async () => {
    const { keyboard, injectCombo } = await load();
    expect(await injectCombo({ mods: ["BOGUS"], key: "c" })).toBe("BOGUS+c");
    expect(keyboard.type).toHaveBeenLastCalledWith("C"); // unmapped mod dropped
  });
});

describe("injectCombo — errors", () => {
  it("throws on an unmappable base key without typing anything", async () => {
    const { keyboard, injectCombo } = await load();
    await expect(injectCombo({ mods: ["MOD"], key: "£" })).rejects.toThrow(/unmapped key/);
    expect(keyboard.type).not.toHaveBeenCalled();
  });

  it("throws on a modifier-only frame (no base key) without typing anything", async () => {
    const { keyboard, injectCombo } = await load();
    await expect(injectCombo({ mods: ["MOD"] })).rejects.toThrow(/unmapped key/);
    expect(keyboard.type).not.toHaveBeenCalled();
  });
});

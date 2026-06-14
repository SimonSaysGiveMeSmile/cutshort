import { describe, it, expect } from "vitest";
import {
  SHORTCUTS,
  CATEGORIES,
  resolveCombo,
  comboLabel,
  type Shortcut,
  type Combo,
  type ModToken,
} from "./shortcuts";

const VALID_MODS: ModToken[] = ["MOD", "SHIFT", "ALT", "CTRL", "SUPER"];
const VALID_CATEGORIES = new Set(CATEGORIES.map((c) => c.id));

describe("resolveCombo", () => {
  it("falls back to the base combo when there is no per-OS override", () => {
    const copy = SHORTCUTS.find((s) => s.id === "copy")!;
    expect(resolveCombo(copy, "mac")).toBe(copy.combo);
    expect(resolveCombo(copy, "win")).toBe(copy.combo);
  });

  it("prefers the mac override on mac and the base combo on win", () => {
    // clearcache has a mac override but no win override.
    const cc = SHORTCUTS.find((s) => s.id === "clearcache")!;
    expect(cc.mac).toBeDefined();
    expect(cc.win).toBeUndefined();
    expect(resolveCombo(cc, "mac")).toBe(cc.mac);
    expect(resolveCombo(cc, "win")).toBe(cc.combo);
  });

  it("prefers the win override on win and the base combo on mac", () => {
    // redo has a win override but no mac override.
    const redo = SHORTCUTS.find((s) => s.id === "redo")!;
    expect(redo.win).toBeDefined();
    expect(redo.mac).toBeUndefined();
    expect(resolveCombo(redo, "win")).toBe(redo.win);
    expect(resolveCombo(redo, "mac")).toBe(redo.combo);
  });

  it("uses each side's own override when both are present", () => {
    // search defines explicit mac and win combos.
    const search = SHORTCUTS.find((s) => s.id === "search")!;
    expect(resolveCombo(search, "mac")).toBe(search.mac);
    expect(resolveCombo(search, "win")).toBe(search.win);
  });
});

describe("comboLabel — mac (glyphs, no separator)", () => {
  const cases: Array<[Combo, string]> = [
    [{ mods: ["MOD"], key: "c" }, "⌘C"],
    [{ mods: ["MOD", "SHIFT"], key: "r" }, "⌘⇧R"],
    [{ mods: ["MOD", "ALT"], key: "i" }, "⌘⌥I"],
    [{ mods: ["MOD", "CTRL"], key: "f" }, "⌘⌃F"],
    [{ mods: ["MOD"], key: " " }, "⌘Space"],
    [{ mods: ["MOD"], key: "Enter" }, "⌘↩"],
    [{ mods: ["MOD"], key: "Tab" }, "⌘⇥"],
    [{ mods: ["MOD", "ALT"], key: "ArrowDown" }, "⌘⌥↓"],
    [{ mods: [], key: "F11" }, "F11"],
    [{ mods: ["MOD", "SHIFT"], key: "Backspace" }, "⌘⇧⌫"],
  ];
  it.each(cases)("formats %j as %s", (combo, expected) => {
    expect(comboLabel(combo, "mac")).toBe(expected);
  });
});

describe("comboLabel — win (words, + separator)", () => {
  const cases: Array<[Combo, string]> = [
    [{ mods: ["MOD"], key: "c" }, "Ctrl+C"],
    [{ mods: ["MOD", "SHIFT"], key: "r" }, "Ctrl+Shift+R"],
    [{ mods: ["ALT"], key: "Tab" }, "Alt+Tab"],
    [{ mods: ["SUPER"], key: "s" }, "Win+S"],
    [{ mods: ["SUPER", "SHIFT"], key: "s" }, "Win+Shift+S"],
    [{ mods: ["MOD"], key: " " }, "Ctrl+Space"],
    [{ mods: ["MOD", "SHIFT"], key: "Delete" }, "Ctrl+Shift+Del"],
    [{ mods: [], key: "F11" }, "F11"],
    [{ mods: ["ALT"], key: "F4" }, "Alt+F4"],
  ];
  it.each(cases)("formats %j as %s", (combo, expected) => {
    expect(comboLabel(combo, "win")).toBe(expected);
  });
});

describe("SHORTCUTS / CATEGORIES data integrity", () => {
  it("has unique shortcut ids", () => {
    const ids = SHORTCUTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has unique category ids", () => {
    const ids = CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("only references categories that exist", () => {
    for (const s of SHORTCUTS) {
      expect(VALID_CATEGORIES.has(s.category), `${s.id} -> ${s.category}`).toBe(true);
    }
  });

  it("gives every combo a non-empty key and only valid modifier tokens", () => {
    const checkCombo = (c: Combo, where: string) => {
      expect(c.key.length, `${where} key`).toBeGreaterThan(0);
      for (const m of c.mods) {
        expect(VALID_MODS.includes(m), `${where} mod ${m}`).toBe(true);
      }
    };
    for (const s of SHORTCUTS) {
      checkCombo(s.combo, `${s.id}.combo`);
      if (s.mac) checkCombo(s.mac, `${s.id}.mac`);
      if (s.win) checkCombo(s.win, `${s.id}.win`);
    }
  });

  it("produces a non-empty label for every shortcut on both platforms", () => {
    for (const s of SHORTCUTS as Shortcut[]) {
      expect(comboLabel(resolveCombo(s, "mac"), "mac").length).toBeGreaterThan(0);
      expect(comboLabel(resolveCombo(s, "win"), "win").length).toBeGreaterThan(0);
    }
  });
});

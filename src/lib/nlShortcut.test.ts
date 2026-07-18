import { describe, it, expect } from "vitest";
import { parseShortcutPhrase } from "./nlShortcut";

describe("parseShortcutPhrase", () => {
  it("returns null for empty / whitespace / keyless phrases", () => {
    expect(parseShortcutPhrase("", "mac")).toBeNull();
    expect(parseShortcutPhrase("   ", "mac")).toBeNull();
    expect(parseShortcutPhrase("copy", "mac")).toBeNull(); // bare action name, no key
    expect(parseShortcutPhrase("rename symbol", "mac")).toBeNull();
  });

  it("parses a plain modifier+key combo", () => {
    expect(parseShortcutPhrase("cmd shift p", "mac")).toEqual({
      mods: ["MOD", "SHIFT"],
      key: "p",
      label: "",
    });
  });

  it("accepts +/- joined combos and glyph modifiers", () => {
    expect(parseShortcutPhrase("cmd-shift-p", "mac")).toEqual({ mods: ["MOD", "SHIFT"], key: "p", label: "" });
    expect(parseShortcutPhrase("cmd+shift+p", "mac")).toEqual({ mods: ["MOD", "SHIFT"], key: "p", label: "" });
    expect(parseShortcutPhrase("⌘⇧P", "mac")).toEqual({ mods: ["MOD", "SHIFT"], key: "p", label: "" });
  });

  it("resolves ctrl per-OS: everyday modifier on Windows, literal Control on macOS", () => {
    expect(parseShortcutPhrase("ctrl c", "win")).toEqual({ mods: ["MOD"], key: "c", label: "" });
    expect(parseShortcutPhrase("ctrl c", "mac")).toEqual({ mods: ["CTRL"], key: "c", label: "" });
  });

  it("maps option/opt/alt to ALT and win/super to SUPER", () => {
    expect(parseShortcutPhrase("option f2", "mac")).toEqual({ mods: ["ALT"], key: "F2", label: "" });
    expect(parseShortcutPhrase("win s", "win")).toEqual({ mods: ["SUPER"], key: "s", label: "" });
  });

  it("derives a title-cased label from the leftover words", () => {
    expect(parseShortcutPhrase("toggle sidebar cmd b", "mac")).toEqual({
      mods: ["MOD"],
      key: "b",
      label: "Toggle Sidebar",
    });
    expect(parseShortcutPhrase("command palette cmd shift p", "mac")).toEqual({
      mods: ["MOD", "SHIFT"],
      key: "p",
      label: "Command Palette",
    });
  });

  it("handles a modifier-less shortcut (label + bare key)", () => {
    expect(parseShortcutPhrase("rename symbol f2", "mac")).toEqual({
      mods: [],
      key: "F2",
      label: "Rename Symbol",
    });
  });

  it("normalizes named keys (space, enter, delete, arrows, punctuation)", () => {
    expect(parseShortcutPhrase("cmd space", "mac").key).toBe(" ");
    expect(parseShortcutPhrase("cmd enter", "mac").key).toBe("Enter");
    expect(parseShortcutPhrase("cmd return", "mac").key).toBe("Enter");
    expect(parseShortcutPhrase("ctrl alt delete", "win")).toEqual({ mods: ["MOD", "ALT"], key: "Delete", label: "" });
    expect(parseShortcutPhrase("cmd down", "mac").key).toBe("ArrowDown");
    expect(parseShortcutPhrase("cmd slash", "mac").key).toBe("/");
    expect(parseShortcutPhrase("cmd /", "mac").key).toBe("/");
  });

  it("resolves +/-/= as the key so the glyph and word forms agree (zoom in/out)", () => {
    // Regression: "+" used to be missing from normalizeKey's punctuation class, so
    // "cmd +" parsed to null while its word twin "cmd plus" worked. Pin them together.
    expect(parseShortcutPhrase("cmd +", "mac")).toEqual({ mods: ["MOD"], key: "+", label: "" });
    expect(parseShortcutPhrase("cmd plus", "mac")).toEqual({ mods: ["MOD"], key: "+", label: "" });
    expect(parseShortcutPhrase("cmd -", "mac")).toEqual({ mods: ["MOD"], key: "-", label: "" });
    expect(parseShortcutPhrase("cmd =", "mac")).toEqual({ mods: ["MOD"], key: "=", label: "" });
    // leftover words still become the label, key still the trailing "+"
    expect(parseShortcutPhrase("zoom in cmd +", "mac")).toEqual({ mods: ["MOD"], key: "+", label: "Zoom In" });
  });

  it("canonicalizes modifier order regardless of how they were typed", () => {
    // Typed shift, cmd, alt → sorted to MOD, SHIFT, ALT (built-in display order).
    expect(parseShortcutPhrase("shift cmd alt k", "mac")).toEqual({
      mods: ["MOD", "SHIFT", "ALT"],
      key: "k",
      label: "",
    });
  });

  it("de-duplicates repeated modifiers", () => {
    expect(parseShortcutPhrase("cmd command s", "mac")).toEqual({ mods: ["MOD"], key: "s", label: "" });
  });

  it("treats the LAST key-like token as the key and earlier ones as label words", () => {
    expect(parseShortcutPhrase("a quick note cmd n", "mac")).toEqual({
      mods: ["MOD"],
      key: "n",
      label: "A Quick Note",
    });
  });

  it("uppercases function keys", () => {
    expect(parseShortcutPhrase("f12", "mac")).toEqual({ mods: [], key: "F12", label: "" });
  });

  it("resolves the high function keys F13–F24 the agent injects", () => {
    // The parser capped at F12 while keys.js injects F1–F24 — a whole range of keys
    // the backend supports was unreachable from the NL box. Pin the widened range.
    expect(parseShortcutPhrase("f13", "mac")).toEqual({ mods: [], key: "F13", label: "" });
    expect(parseShortcutPhrase("shift f24", "win")).toEqual({ mods: ["SHIFT"], key: "F24", label: "" });
    expect(parseShortcutPhrase("f25", "mac")).toBeNull(); // still out of range
  });

  it("resolves the navigation keys the agent injects (home/end/page up-down/insert)", () => {
    // keys.js maps Home/End/PageUp/PageDown/Insert but the parser couldn't produce
    // them. "cmd page up" used to drop the modifier and resolve a bare ArrowUp.
    expect(parseShortcutPhrase("cmd home", "mac")).toEqual({ mods: ["MOD"], key: "Home", label: "" });
    expect(parseShortcutPhrase("ctrl end", "win")).toEqual({ mods: ["MOD"], key: "End", label: "" });
    expect(parseShortcutPhrase("cmd page up", "mac")).toEqual({ mods: ["MOD"], key: "PageUp", label: "" });
    expect(parseShortcutPhrase("cmd page down", "mac")).toEqual({ mods: ["MOD"], key: "PageDown", label: "" });
    expect(parseShortcutPhrase("pgup", "mac")).toEqual({ mods: [], key: "PageUp", label: "" });
    expect(parseShortcutPhrase("pgdn", "mac")).toEqual({ mods: [], key: "PageDown", label: "" });
    expect(parseShortcutPhrase("insert", "mac")).toEqual({ mods: [], key: "Insert", label: "" });
    // a bare "up"/"down" with no leading "page" is still an arrow key, not PageUp
    expect(parseShortcutPhrase("cmd up", "mac")).toEqual({ mods: ["MOD"], key: "ArrowUp", label: "" });
  });

  it("keeps a leading modifier-synonym word in the label when it's not in the combo cluster", () => {
    // "alt" here is a label word (separated from the cmd+a cluster by "text").
    expect(parseShortcutPhrase("alt text cmd a", "mac")).toEqual({
      mods: ["MOD"],
      key: "a",
      label: "Alt Text",
    });
  });

  it("keeps trailing non-combo words in the label when the key is mid-phrase", () => {
    expect(parseShortcutPhrase("cmd k something", "mac")).toEqual({
      mods: ["MOD"],
      key: "k",
      label: "Something",
    });
  });
});

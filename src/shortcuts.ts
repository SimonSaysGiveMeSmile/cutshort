// Shortcut model
// ---------------
// A combo is described in OS-neutral tokens. "MOD" resolves to ⌘ on macOS and
// Ctrl on Windows — that single mapping covers the vast majority of dev
// shortcuts. Anything genuinely platform-divergent gets an explicit `win`/`mac`
// override on the shortcut itself.

export type OS = "mac" | "win";

/** OS-neutral modifier tokens. MOD = Cmd(mac)/Ctrl(win). */
export type ModToken = "MOD" | "SHIFT" | "ALT" | "CTRL";

export interface Combo {
  mods: ModToken[];
  /** Base key, e.g. "c", "Enter", "F5", "ArrowLeft". */
  key: string;
}

export interface Shortcut {
  id: string;
  label: string;
  glyph: string; // a compact icon/emoji shown on the key
  category: CategoryId;
  combo: Combo;
  /** Optional per-OS override when the combo genuinely differs. */
  mac?: Combo;
  win?: Combo;
  /** Marks combos that benefit from a hold/repeat (e.g. volume, arrows). */
  repeatable?: boolean;
}

export type CategoryId = "edit" | "browser" | "window" | "dev";

export interface Category {
  id: CategoryId;
  label: string;
  glyph: string;
}

export const CATEGORIES: Category[] = [
  { id: "edit", label: "Editing", glyph: "✏️" },
  { id: "browser", label: "Browser", glyph: "🌐" },
  { id: "window", label: "System", glyph: "🖥️" },
  { id: "dev", label: "Dev", glyph: "⌥" },
];

export const SHORTCUTS: Shortcut[] = [
  // — Editing —
  { id: "copy", label: "Copy", glyph: "⧉", category: "edit", combo: { mods: ["MOD"], key: "c" } },
  { id: "cut", label: "Cut", glyph: "✂", category: "edit", combo: { mods: ["MOD"], key: "x" } },
  { id: "paste", label: "Paste", glyph: "📋", category: "edit", combo: { mods: ["MOD"], key: "v" } },
  { id: "selall", label: "Select All", glyph: "▦", category: "edit", combo: { mods: ["MOD"], key: "a" } },
  { id: "undo", label: "Undo", glyph: "↶", category: "edit", combo: { mods: ["MOD"], key: "z" } },
  {
    id: "redo",
    label: "Redo",
    glyph: "↷",
    category: "edit",
    combo: { mods: ["MOD", "SHIFT"], key: "z" },
    win: { mods: ["MOD"], key: "y" },
  },
  { id: "save", label: "Save", glyph: "💾", category: "edit", combo: { mods: ["MOD"], key: "s" } },
  { id: "find", label: "Find", glyph: "🔍", category: "edit", combo: { mods: ["MOD"], key: "f" } },

  // — Browser —
  { id: "reload", label: "Reload", glyph: "↻", category: "browser", combo: { mods: ["MOD"], key: "r" } },
  {
    id: "hardreload",
    label: "Hard Reload",
    glyph: "⟳",
    category: "browser",
    combo: { mods: ["MOD", "SHIFT"], key: "r" },
  },
  { id: "newtab", label: "New Tab", glyph: "＋", category: "browser", combo: { mods: ["MOD"], key: "t" } },
  { id: "closetab", label: "Close Tab", glyph: "✕", category: "browser", combo: { mods: ["MOD"], key: "w" } },
  {
    id: "reopen",
    label: "Reopen Tab",
    glyph: "⎌",
    category: "browser",
    combo: { mods: ["MOD", "SHIFT"], key: "t" },
  },
  {
    id: "devtools",
    label: "DevTools",
    glyph: "🛠",
    category: "browser",
    combo: { mods: ["MOD", "ALT"], key: "i" },
    win: { mods: ["MOD", "SHIFT"], key: "i" },
  },
  {
    id: "incognito",
    label: "Incognito",
    glyph: "🕶",
    category: "browser",
    combo: { mods: ["MOD", "SHIFT"], key: "n" },
  },
  {
    id: "clearcache",
    label: "Clear Cache",
    glyph: "🧹",
    category: "browser",
    // Mac Chrome devtools-less hard-clear varies; we send the broadly-safe
    // "open clear-browsing-data" combo. Refine per test results.
    combo: { mods: ["MOD", "SHIFT"], key: "Delete" },
    mac: { mods: ["MOD", "SHIFT"], key: "Backspace" },
  },

  // — System / Window —
  { id: "search", label: "Spotlight", glyph: "🔦", category: "window", combo: { mods: ["MOD"], key: " " }, mac: { mods: ["MOD"], key: " " }, win: { mods: ["MOD"], key: "s" } },
  { id: "switch", label: "Switch App", glyph: "⇄", category: "window", combo: { mods: ["MOD"], key: "Tab" }, win: { mods: ["ALT"], key: "Tab" } },
  { id: "fullscreen", label: "Fullscreen", glyph: "⛶", category: "window", combo: { mods: ["MOD", "CTRL"], key: "f" }, win: { mods: [], key: "F11" } },
  { id: "screenshot", label: "Screenshot", glyph: "📸", category: "window", combo: { mods: ["MOD", "SHIFT"], key: "4" }, win: { mods: ["MOD", "SHIFT"], key: "s" } },
  { id: "quit", label: "Quit App", glyph: "⏻", category: "window", combo: { mods: ["MOD"], key: "q" }, win: { mods: ["ALT"], key: "F4" } },

  // — Dev —
  { id: "palette", label: "Cmd Palette", glyph: "⌘", category: "dev", combo: { mods: ["MOD", "SHIFT"], key: "p" } },
  { id: "comment", label: "Comment", glyph: "//", category: "dev", combo: { mods: ["MOD"], key: "/" } },
  { id: "format", label: "Format", glyph: "{ }", category: "dev", combo: { mods: ["MOD", "SHIFT"], key: "f" }, mac: { mods: ["MOD", "ALT"], key: "f" } },
  { id: "terminal", label: "Terminal", glyph: "›_", category: "dev", combo: { mods: ["MOD"], key: "`" } },
  { id: "multicursor", label: "Add Cursor", glyph: "❘❘", category: "dev", combo: { mods: ["MOD", "ALT"], key: "ArrowDown" }, repeatable: true },
];

/** Resolve the OS-specific combo for a shortcut. */
export function resolveCombo(s: Shortcut, os: OS): Combo {
  return (os === "mac" ? s.mac : s.win) ?? s.combo;
}

const MAC_GLYPHS: Record<string, string> = {
  MOD: "⌘",
  SHIFT: "⇧",
  ALT: "⌥",
  CTRL: "⌃",
  " ": "Space",
  Enter: "↩",
  Tab: "⇥",
  Delete: "⌦",
  Backspace: "⌫",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

const WIN_GLYPHS: Record<string, string> = {
  MOD: "Ctrl",
  SHIFT: "Shift",
  ALT: "Alt",
  CTRL: "Ctrl",
  " ": "Space",
  Enter: "Enter",
  Tab: "Tab",
  Delete: "Del",
  Backspace: "Bksp",
};

/** Human-readable combo string, e.g. "⌘⇧R" (mac) or "Ctrl+Shift+R" (win). */
export function comboLabel(combo: Combo, os: OS): string {
  const map = os === "mac" ? MAC_GLYPHS : WIN_GLYPHS;
  const parts = [...combo.mods.map((m) => map[m] ?? m), map[combo.key] ?? combo.key.toUpperCase()];
  return os === "mac" ? parts.join("") : parts.join("+");
}

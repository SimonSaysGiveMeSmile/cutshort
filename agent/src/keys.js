// Keystroke injection
// --------------------
// Turns an OS-neutral combo frame ({ mods:[...], key }) into a real key event
// via nut.js. The MOD/SUPER tokens resolve against THIS machine's platform —
// not whatever the phone thinks — so the agent is the source of truth.

import { keyboard, Key } from "@nut-tree-fork/nut-js";

const isMac = process.platform === "darwin";

// nut.js types modifiers + base key together as a chord (press all, release all).
keyboard.config.autoDelayMs = 2;

const MOD_MAP = {
  MOD: isMac ? Key.LeftCmd : Key.LeftControl,
  SUPER: isMac ? Key.LeftCmd : Key.LeftSuper,
  SHIFT: Key.LeftShift,
  ALT: Key.LeftAlt,
  CTRL: Key.LeftControl,
};

const NAMED = {
  // Enter maps to the main Return key (kVK_Return), not the numeric-keypad Enter
  // — apps that distinguish them expect Return.
  Enter: Key.Return,
  Tab: Key.Tab,
  Delete: Key.Delete,
  Backspace: Key.Backspace,
  Escape: Key.Escape,
  " ": Key.Space,
  "`": Key.Grave,
  "/": Key.Slash,
  "\\": Key.Backslash,
  ".": Key.Period,
  ",": Key.Comma,
  "-": Key.Minus,
  "=": Key.Equal,
  "[": Key.LeftBracket,
  "]": Key.RightBracket,
  ";": Key.Semicolon,
  "'": Key.Quote,
  ArrowUp: Key.Up,
  ArrowDown: Key.Down,
  ArrowLeft: Key.Left,
  ArrowRight: Key.Right,
  Home: Key.Home,
  End: Key.End,
  PageUp: Key.PageUp,
  PageDown: Key.PageDown,
  Insert: Key.Insert,
};

// Case-insensitive aliases so the free-form key input the UI invites ("f2",
// "enter", "home") resolves the same as its canonical casing.
const NAMED_LC = Object.fromEntries(
  Object.entries(NAMED).map(([k, v]) => [k.toLowerCase(), v]),
);

const NUM = {
  0: Key.Num0,
  1: Key.Num1,
  2: Key.Num2,
  3: Key.Num3,
  4: Key.Num4,
  5: Key.Num5,
  6: Key.Num6,
  7: Key.Num7,
  8: Key.Num8,
  9: Key.Num9,
};

function baseKey(k) {
  if (typeof k !== "string" || k.length === 0) return undefined;
  if (k in NAMED) return NAMED[k];
  const lc = k.toLowerCase();
  if (lc in NAMED_LC) return NAMED_LC[lc];
  if (/^[a-z]$/.test(lc)) return Key[lc.toUpperCase()];
  if (/^[0-9]$/.test(k)) return NUM[k];
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(lc)) return Key["F" + lc.slice(1)];
  return undefined;
}

/** Inject a single combo. Returns a human label of what fired. */
export async function injectCombo({ mods = [], key }) {
  const modifiers = mods.map((m) => MOD_MAP[m]).filter((x) => x !== undefined);
  const base = baseKey(key);
  if (base === undefined) {
    throw new Error(`unmapped key: ${JSON.stringify(key)}`);
  }
  await keyboard.type(...modifiers, base);
  return [...mods, key].join("+");
}

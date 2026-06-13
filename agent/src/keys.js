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
  ALT: isMac ? Key.LeftAlt : Key.LeftAlt,
  CTRL: Key.LeftControl,
};

const NAMED = {
  Enter: Key.Enter,
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
  ArrowUp: Key.Up,
  ArrowDown: Key.Down,
  ArrowLeft: Key.Left,
  ArrowRight: Key.Right,
};

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
  if (k in NAMED) return NAMED[k];
  if (/^[a-zA-Z]$/.test(k)) return Key[k.toUpperCase()];
  if (/^[0-9]$/.test(k)) return NUM[k];
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(k)) return Key[k];
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

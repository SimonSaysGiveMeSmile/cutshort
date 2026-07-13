// Natural-language shortcut parsing
// ---------------------------------
// The roadmap's "embedded agent" lets you describe a shortcut in words and wires
// up the combo by composing the existing editor + Shortcut model (it fills the
// same fields the New-shortcut form does and calls the same addCustom()). This is
// the deterministic core of that: it turns a phrase like "toggle sidebar cmd b"
// or "⌘⇧P command palette" into { mods, key, label } to pre-fill the form. It is
// pure so it's fully unit-testable; an LLM path can later resolve pure action
// names ("rename symbol" -> F2) that this rule-based parser deliberately leaves
// to the user.

import type { ModToken, OS } from "../shortcuts";

export interface ParsedShortcut {
  mods: ModToken[];
  key: string;
  /** Title-cased leftover words as a suggested label ("" when the phrase is combo-only). */
  label: string;
}

// Modifier synonyms → token. "ctrl"/"control"/"⌃" is resolved per-OS in
// resolveModWord (it's the everyday modifier on Windows, a literal key on macOS).
const MOD_WORDS: Record<string, ModToken> = {
  cmd: "MOD",
  command: "MOD",
  "⌘": "MOD",
  mod: "MOD",
  shift: "SHIFT",
  "⇧": "SHIFT",
  alt: "ALT",
  option: "ALT",
  opt: "ALT",
  "⌥": "ALT",
  win: "SUPER",
  windows: "SUPER",
  super: "SUPER",
  meta: "SUPER",
  "⊞": "SUPER",
};

// Spoken key names → the canonical key string the Combo model expects.
const KEY_WORDS: Record<string, string> = {
  space: " ",
  spacebar: " ",
  enter: "Enter",
  return: "Enter",
  tab: "Tab",
  esc: "Escape",
  escape: "Escape",
  del: "Delete",
  delete: "Delete",
  backspace: "Backspace",
  bksp: "Backspace",
  up: "ArrowUp",
  arrowup: "ArrowUp",
  down: "ArrowDown",
  arrowdown: "ArrowDown",
  left: "ArrowLeft",
  arrowleft: "ArrowLeft",
  right: "ArrowRight",
  arrowright: "ArrowRight",
  plus: "+",
  minus: "-",
  slash: "/",
  backslash: "\\",
  comma: ",",
  period: ".",
  dot: ".",
  backtick: "`",
  grave: "`",
  tilde: "`",
};

// Canonical display order, matching the built-in shortcuts (MOD/SUPER lead).
const MOD_RANK: Record<ModToken, number> = { MOD: 0, SUPER: 1, SHIFT: 2, ALT: 3, CTRL: 4 };

function resolveModWord(word: string, os: OS): ModToken | null {
  if (word === "ctrl" || word === "control" || word === "⌃") {
    // Windows: Ctrl IS the everyday modifier (our MOD token). macOS: it's the
    // literal Control key, distinct from ⌘.
    return os === "win" ? "MOD" : "CTRL";
  }
  return MOD_WORDS[word] ?? null;
}

function normalizeKey(word: string): string | null {
  if (KEY_WORDS[word]) return KEY_WORDS[word];
  const fkey = /^f([1-9]|1[0-2])$/.exec(word); // f1..f12
  if (fkey) return `F${fkey[1]}`;
  if (/^[a-z0-9]$/.test(word)) return word; // single letter / digit
  // A lone punctuation key. "+" is included so "cmd +" (zoom-in) resolves the same
  // key as the word form "cmd plus" (KEY_WORDS.plus === "+") instead of parsing to
  // null — its unshifted twin "=" and "-" were already here.
  if (/^[+/\\`\-=[\];',.]$/.test(word)) return word;
  return null;
}

function titleCase(words: readonly string[]): string {
  return words
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ")
    .trim();
}

/**
 * Parse a natural-language phrase into a shortcut draft, or null when no key can
 * be identified (a bare action name like "copy" — left for the user / LLM path).
 * Modifiers may be words ("cmd", "option"), glyphs ("⌘⇧"), or "+/-"-joined
 * ("cmd-shift-p"); the key is the last key-like token, and everything else
 * becomes a suggested label.
 */
export function parseShortcutPhrase(text: string, os: OS): ParsedShortcut | null {
  if (!text || !text.trim()) return null;
  const tokens = text
    .replace(/([⌘⇧⌥⌃⊞])/g, " $1 ") // split glyph runs like "⌘⇧P" apart
    .trim()
    .toLowerCase()
    .split(/\s+/)
    // Expand "cmd+shift+p" / "cmd-shift-p", but keep a lone "-"/"+" (the key).
    .flatMap((t) => (t.length > 1 ? t.split(/[+\-]/).filter(Boolean) : [t]));

  // Classify each token up front: a modifier (its resolved token) or, failing
  // that, a key. Anything that's neither is a label word.
  const modAt = tokens.map((t) => resolveModWord(t, os));
  const keyByIndex: Record<number, string> = {};
  const keyIndices: number[] = [];
  tokens.forEach((tok, i) => {
    if (modAt[i]) return;
    const k = normalizeKey(tok);
    if (k) {
      keyByIndex[i] = k;
      keyIndices.push(i);
    }
  });

  if (keyIndices.length === 0) return null; // no key → not a parseable combo
  // The actual key is the LAST key-like token; an earlier single-letter token is
  // more likely a label word ("a quick note cmd n" → key n, label "A Quick Note").
  const chosenIndex = keyIndices[keyIndices.length - 1];
  const key = keyByIndex[chosenIndex];

  // The combo's modifiers are the *contiguous* run of modifier tokens immediately
  // before the key. A modifier-synonym word separated from that run by a label
  // word is treated as a label word ("command palette cmd shift p" → the leading
  // "command" is part of the label, only the trailing "cmd shift" are modifiers).
  const clusterIndices = new Set<number>();
  const clusterMods: ModToken[] = [];
  for (let i = chosenIndex - 1; i >= 0 && modAt[i]; i--) {
    clusterIndices.add(i);
    clusterMods.push(modAt[i] as ModToken);
  }
  const mods = [...new Set(clusterMods)].sort((a, b) => MOD_RANK[a] - MOD_RANK[b]);

  const labelWords: string[] = [];
  tokens.forEach((tok, i) => {
    if (i === chosenIndex || clusterIndices.has(i)) return;
    labelWords.push(tok);
  });

  return { mods, key, label: titleCase(labelWords) };
}

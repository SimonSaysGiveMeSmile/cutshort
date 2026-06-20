// Customizable shortcut store
// ----------------------------
// The deck renders from here, not directly from the static SHORTCUTS list.
// Users can add their own shortcuts and hide built-ins; both persist to
// localStorage. This is also the surface the (future) embedded customization
// agent edits — it composes existing Shortcut data, it doesn't generate UI.

import { SHORTCUTS, type CategoryId, type Combo, type Shortcut } from "../shortcuts";

export interface CustomShortcut extends Shortcut {
  custom: true;
}

const KEY_CUSTOM = "cutshort.custom";
const KEY_HIDDEN = "cutshort.hidden";

function isCombo(c: unknown): c is Combo {
  if (typeof c !== "object" || c === null) return false;
  const o = c as Record<string, unknown>;
  return Array.isArray(o.mods) && o.mods.every((m) => typeof m === "string") && typeof o.key === "string";
}

// Stored custom shortcuts flow unvalidated into the render path (comboLabel reads
// combo.mods/combo.key), so one malformed/old/hand-edited record would throw and
// white-screen the whole deck. Accept only well-formed entries; silently drop the
// rest rather than crash.
function isValidCustom(x: unknown): x is CustomShortcut {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.label === "string" &&
    typeof o.icon === "string" &&
    typeof o.category === "string" &&
    isCombo(o.combo) &&
    (o.mac === undefined || isCombo(o.mac)) &&
    (o.win === undefined || isCombo(o.win))
  );
}

function loadCustom(): CustomShortcut[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY_CUSTOM) || "[]");
    return Array.isArray(raw) ? raw.filter(isValidCustom) : [];
  } catch {
    return [];
  }
}
function loadHidden(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY_HIDDEN) || "[]");
    // Accept only an array of string ids — a stored JSON string would otherwise
    // be iterated into per-character garbage ids by `new Set("copy")`.
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

let custom = loadCustom();
let hidden = loadHidden();

const listeners = new Set<() => void>();
let snapshot: Shortcut[] = compute();

function compute(): Shortcut[] {
  return [...SHORTCUTS.filter((s) => !hidden.has(s.id)), ...custom];
}
function persist() {
  try {
    localStorage.setItem(KEY_CUSTOM, JSON.stringify(custom));
    localStorage.setItem(KEY_HIDDEN, JSON.stringify([...hidden]));
  } catch {
    /* private mode */
  }
}
function refresh() {
  snapshot = compute();
  persist();
  listeners.forEach((l) => l());
}

// — useSyncExternalStore wiring —
export function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function getShortcuts(): Shortcut[] {
  return snapshot;
}

// — mutations —
export interface NewShortcut {
  label: string;
  icon: string;
  category: CategoryId;
  combo: Combo;
}

function genId(): string {
  return "c" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
}

export function addCustom(s: NewShortcut): string {
  const id = genId();
  custom = [...custom, { ...s, id, custom: true }];
  refresh();
  return id;
}
export function updateCustom(id: string, patch: Partial<NewShortcut>) {
  custom = custom.map((c) => (c.id === id ? { ...c, ...patch } : c));
  refresh();
}
/** Remove a custom shortcut, or hide a built-in one. */
export function removeShortcut(id: string) {
  if (custom.some((c) => c.id === id)) {
    custom = custom.filter((c) => c.id !== id);
  } else {
    hidden.add(id);
  }
  refresh();
}
export function restoreBuiltin(id: string) {
  if (hidden.delete(id)) refresh();
}
export function isHidden(id: string) {
  return hidden.has(id);
}
export function isCustom(id: string) {
  return custom.some((c) => c.id === id);
}
export const builtins = SHORTCUTS;

// Target-OS preference persistence
// --------------------------------
// Which machine the deck drives (mac vs win) should survive a reload the way the
// theme and mode do. This is only the pre-connect default and the remembered
// manual toggle — once paired, the agent's own OS (a pairing `os` param or a
// hello frame) still wins. Guarded because localStorage can *throw* on access
// (sandboxed iframe, some privacy modes), not merely be absent.

import type { OS } from "../shortcuts";

const KEY = "cutshort.os";

export function loadOS(): OS {
  try {
    const saved = localStorage.getItem(KEY);
    return saved === "mac" || saved === "win" ? saved : "mac";
  } catch {
    return "mac";
  }
}

export function saveOS(os: OS): void {
  try {
    localStorage.setItem(KEY, os);
  } catch {
    /* best-effort: a failed persist must not break the OS toggle */
  }
}

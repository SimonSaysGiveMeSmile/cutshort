// Modal dialog behavior
// ----------------------
// The bottom sheets declare role="dialog" but had none of the behavior that
// implies: no Escape-to-close, no focus management. The DOM wiring lives in the
// pure `wireDialog` (testable in jsdom without rendering); `useDialog` is the
// thin React glue over it.

import { useEffect, useRef } from "react";

/**
 * Wire a dialog node's keyboard + focus behavior. Moves focus into the dialog,
 * closes it on Escape, and on cleanup removes the listener and restores focus to
 * whatever was focused before (the trigger). Returns a cleanup function.
 */
export function wireDialog(node: HTMLElement | null, onClose: () => void): () => void {
  if (typeof document === "undefined") return () => {};
  const prev = document.activeElement as HTMLElement | null;
  node?.focus();
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    }
  };
  document.addEventListener("keydown", onKey);
  return () => {
    document.removeEventListener("keydown", onKey);
    prev?.focus?.();
  };
}

/**
 * React hook: attach the returned ref to the dialog element. onClose may change
 * between renders without re-running the effect (it's read through a ref), so
 * focus isn't stolen on every parent re-render.
 */
export function useDialog<T extends HTMLElement>(onClose: () => void) {
  const ref = useRef<T>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => wireDialog(ref.current, () => onCloseRef.current()), []);
  return ref;
}

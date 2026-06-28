// Modal dialog behavior
// ----------------------
// The bottom sheets declare role="dialog" but had none of the behavior that
// implies: no Escape-to-close, no focus management. The DOM wiring lives in the
// pure `wireDialog` (testable in jsdom without rendering); `useDialog` is the
// thin React glue over it.

import { useEffect, useRef } from "react";

// The focusable descendants of a dialog, in tab order. Excludes disabled controls
// and tabindex=-1 (e.g. the dialog container itself). No visibility filter on
// purpose: jsdom reports no layout, and the sheets never hold hidden focusables.
export function dialogFocusables(node: HTMLElement): HTMLElement[] {
  return Array.from(
    node.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  );
}

/**
 * Wire a dialog node's keyboard + focus behavior. Moves focus into the dialog,
 * closes it on Escape, traps Tab/Shift+Tab so focus can't wander onto the deck
 * behind the scrim (the sheets declare aria-modal but nothing enforced it), and on
 * cleanup removes the listener and restores focus to the trigger. Returns a cleanup
 * function.
 */
export function wireDialog(node: HTMLElement | null, onClose: () => void): () => void {
  if (typeof document === "undefined") return () => {};
  const prev = document.activeElement as HTMLElement | null;
  node?.focus();
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    // Only trap when focus is actually inside the dialog, so we never hijack Tab for
    // the rest of the page.
    if (e.key === "Tab" && node && node.contains(document.activeElement)) {
      const items = dialogFocusables(node);
      if (items.length === 0) {
        e.preventDefault();
        node.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === node)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
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

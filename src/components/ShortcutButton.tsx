import { useRef } from "react";
import { comboLabel, resolveCombo, type OS, type Shortcut } from "../shortcuts";
import { rippleGeometry } from "../lib/ripple";
import { Icon } from "./Icon";

interface Props {
  shortcut: Shortcut;
  os: OS;
  onFire: (s: Shortcut) => void;
}

export function ShortcutButton({ shortcut, os, onFire }: Props) {
  const ref = useRef<HTMLButtonElement>(null);
  const combo = resolveCombo(shortcut, os);

  // Paint the touch ripple at the pointer location. Pointer-only flourish — see
  // why firing lives on onClick below.
  function ripple(e: React.PointerEvent<HTMLButtonElement>) {
    const el = ref.current;
    if (!el) return;
    const g = rippleGeometry(el.getBoundingClientRect(), e.clientX, e.clientY);
    const r = document.createElement("span");
    r.className = "ripple";
    r.style.width = r.style.height = `${g.size}px`;
    r.style.left = `${g.left}px`;
    r.style.top = `${g.top}px`;
    el.appendChild(r);
    setTimeout(() => r.remove(), 600);
  }

  return (
    <button
      ref={ref}
      className="key"
      // Fire on click, not pointerdown: keyboard (Enter/Space), iPad external
      // keyboard / Switch Control, and VoiceOver activation all synthesize a click
      // but never a pointerdown, so pointerdown-only firing was a hard a11y failure
      // for the app's core action. A touch tap emits both, so onFire still runs once
      // (and a scroll that starts on a key no longer mis-fires). Haptics stay in
      // fire()'s tapFeedback so success and failure feel distinct.
      onPointerDown={ripple}
      onClick={() => onFire(shortcut)}
      aria-label={`${shortcut.label} (${comboLabel(combo, os)})`}
    >
      <span className="key-glyph" aria-hidden>
        <Icon name={shortcut.icon} size={26} />
      </span>
      <span className="key-label">{shortcut.label}</span>
      <span className="key-combo">{comboLabel(combo, os)}</span>
    </button>
  );
}

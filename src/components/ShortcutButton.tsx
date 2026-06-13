import { useRef } from "react";
import { comboLabel, resolveCombo, type OS, type Shortcut } from "../shortcuts";

interface Props {
  shortcut: Shortcut;
  os: OS;
  onFire: (s: Shortcut) => void;
}

export function ShortcutButton({ shortcut, os, onFire }: Props) {
  const ref = useRef<HTMLButtonElement>(null);
  const combo = resolveCombo(shortcut, os);

  function handle(e: React.PointerEvent<HTMLButtonElement>) {
    // ripple at touch point
    const el = ref.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      const r = document.createElement("span");
      r.className = "ripple";
      const size = Math.max(rect.width, rect.height) * 0.4;
      r.style.width = r.style.height = `${size}px`;
      r.style.left = `${e.clientX - rect.left}px`;
      r.style.top = `${e.clientY - rect.top}px`;
      el.appendChild(r);
      setTimeout(() => r.remove(), 600);
    }
    if ("vibrate" in navigator) navigator.vibrate?.(8);
    onFire(shortcut);
  }

  return (
    <button
      ref={ref}
      className="key"
      onPointerDown={handle}
      aria-label={`${shortcut.label} (${comboLabel(combo, os)})`}
    >
      <span className="key-glyph" aria-hidden>
        {shortcut.glyph}
      </span>
      <span className="key-label">{shortcut.label}</span>
      <span className="key-combo">{comboLabel(combo, os)}</span>
    </button>
  );
}

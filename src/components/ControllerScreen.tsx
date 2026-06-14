import { useState, useSyncExternalStore } from "react";
import { Palette, Command as CommandIcon, Sun, Moon, SlidersHorizontal, WifiOff } from "lucide-react";
import { ShortcutButton } from "./ShortcutButton";
import { Icon } from "./Icon";
import { EditSheet } from "./EditSheet";
import { getShortcuts, subscribe } from "../lib/shortcutStore";
import type { Mode } from "../themes";
import {
  CATEGORIES,
  comboLabel,
  resolveCombo,
  type CategoryId,
  type OS,
  type Shortcut,
} from "../shortcuts";
import { connection, type ConnState } from "../lib/connection";

interface Props {
  os: OS;
  setOS: (os: OS) => void;
  state: ConnState;
  mode: Mode;
  onToggleMode: () => void;
  onOpenThemes: () => void;
}

export function ControllerScreen({
  os,
  setOS,
  state,
  mode,
  onToggleMode,
  onOpenThemes,
}: Props) {
  const [cat, setCat] = useState<CategoryId>("edit");
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);
  const [editing, setEditing] = useState(false);
  const shortcuts = useSyncExternalStore(subscribe, getShortcuts);

  function fire(s: Shortcut) {
    connection.os = os;
    const combo = resolveCombo(s, os);
    // Only confirm what actually went out — if the link is down the keystroke
    // never reached the Mac, so don't fake a "fired" toast.
    const sent = connection.fire(combo);
    if (!sent && state === "error") connection.retry(); // tapping a key wakes a given-up link
    setToast(
      sent
        ? { text: `${s.label} · ${comboLabel(combo, os)}`, ok: true }
        : { text: state === "connecting" ? "Reconnecting…" : "Not connected", ok: false },
    );
    window.clearTimeout((fire as any)._t);
    (fire as any)._t = window.setTimeout(() => setToast(null), 1100);
  }

  const keys = shortcuts.filter((s) => s.category === cat);

  return (
    <>
      <div className="topbar">
        <span className="brand">
          <span className="dot" />
          CutShort
        </span>
        <span className="spacer" />
        {state === "live" || state === "connecting" ? (
          <span className="status" data-live={state}>
            <span className="led" />
            {state === "live" ? connection.host || "Connected" : "Linking…"}
          </span>
        ) : (
          <button
            className="status status-action"
            data-live={state}
            onClick={() => connection.retry()}
            aria-label="Reconnect to your computer"
          >
            <span className="led" />
            Reconnect
          </button>
        )}
        <button
          className="icon-btn"
          onClick={onToggleMode}
          aria-label={mode === "dark" ? "Switch to light" : "Switch to dark"}
        >
          {mode === "dark" ? (
            <Sun size={18} strokeWidth={1.7} />
          ) : (
            <Moon size={18} strokeWidth={1.7} />
          )}
        </button>
        <button className="icon-btn" onClick={onOpenThemes} aria-label="Change skin">
          <Palette size={18} strokeWidth={1.7} />
        </button>
        <button
          className="icon-btn"
          onClick={() => setEditing(true)}
          aria-label="Customize deck"
        >
          <SlidersHorizontal size={18} strokeWidth={1.7} />
        </button>
      </div>

      <div className="cats">
        <div className="seg" style={{ marginRight: 6 }}>
          <button data-on={os === "mac"} onClick={() => setOS("mac")}>
            macOS
          </button>
          <button data-on={os === "win"} onClick={() => setOS("win")}>
            Windows
          </button>
        </div>
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            className="cat"
            data-on={c.id === cat}
            onClick={() => setCat(c.id)}
          >
            <Icon name={c.icon} size={15} strokeWidth={1.8} />
            {c.label}
          </button>
        ))}
      </div>

      <div className="deck">
        {keys.map((s) => (
          <ShortcutButton key={s.id} shortcut={s} os={os} onFire={fire} />
        ))}
      </div>

      {toast && (
        <div className="toast" data-ok={toast.ok}>
          {toast.ok ? (
            <CommandIcon size={14} strokeWidth={2.2} />
          ) : (
            <WifiOff size={14} strokeWidth={2.2} />
          )}
          {toast.text}
        </div>
      )}

      {editing && <EditSheet os={os} category={cat} onClose={() => setEditing(false)} />}
    </>
  );
}

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
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
import { formatRtt } from "../lib/latency";
import { tapFeedback } from "../lib/haptics";

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
  // The live transport's median round-trip time, refreshed each heartbeat sample —
  // the visible end of the latency A/B. Empty until the first ping is answered.
  const [rtt, setRtt] = useState("");
  const shortcuts = useSyncExternalStore(subscribe, getShortcuts);
  // Held in a ref so rapid taps actually clear the previous dismiss timer — a
  // value stashed on the function object would be lost on every re-render, so an
  // older timer would blank the toast for the key the user just pressed.
  const toastTimer = useRef<number>(0);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  // The agent reports a failed keystroke (e.g. Accessibility permission revoked)
  // over a still-live socket — surface it as a toast so a silently no-op'ing deck
  // doesn't keep looking like it's working.
  useEffect(() => {
    const off = connection.onError((msg) => {
      setToast({ text: msg, ok: false });
      window.clearTimeout(toastTimer.current);
      toastTimer.current = window.setTimeout(() => setToast(null), 1600);
    });
    return () => {
      off();
    };
  }, []);

  // Refresh the latency badge on each RTT sample; blank it whenever we're not
  // live so a stale number can't linger on a dropped link.
  useEffect(() => {
    const off = connection.onRtt(() => {
      const summary = connection.liveLatency();
      setRtt(summary ? formatRtt(summary.median) : "");
    });
    return () => {
      off();
    };
  }, []);
  useEffect(() => {
    if (state !== "live") setRtt("");
  }, [state]);

  function fire(s: Shortcut) {
    connection.os = os;
    const combo = resolveCombo(s, os);
    // Only confirm what actually went out — if the link is down the keystroke
    // never reached the Mac, so don't fake a "fired" toast.
    const sent = connection.fire(combo);
    tapFeedback(sent); // physical confirmation: short tick if it fired, "nope" buzz if not
    const reconnecting = !sent && state === "error";
    if (reconnecting) connection.retry(); // tapping a key wakes a given-up link
    setToast(
      sent
        ? { text: `${s.label} · ${comboLabel(combo, os)}`, ok: true }
        : {
            // `state` is still "error" in this render even though retry() just
            // moved us to "connecting", so reflect the kicked-off attempt here.
            text: state === "connecting" || reconnecting ? "Reconnecting…" : "Not connected",
            ok: false,
          },
    );
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 1100);
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
        {/* Screen-reader-only connection-state announcement. The pill below conveys
            state by LED color + text but isn't a live region; this persistent region
            makes each transition audible without re-announcing the RTT badge (which
            updates every heartbeat) — it reflects state only. */}
        <span className="sr-only" role="status" aria-live="polite">
          {state === "live"
            ? `Connected to ${connection.host || "your computer"}`
            : state === "connecting"
              ? "Connecting to your computer"
              : "Disconnected from your computer"}
        </span>
        {state === "live" || state === "connecting" ? (
          <span className="status" data-live={state}>
            <span className="led" />
            {state === "live" ? connection.host || "Connected" : "Linking…"}
            {state === "live" && rtt ? <span className="rtt">{rtt}</span> : null}
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
        <div className="seg" style={{ marginRight: 6 }} role="group" aria-label="Target OS">
          <button data-on={os === "mac"} aria-pressed={os === "mac"} onClick={() => setOS("mac")}>
            macOS
          </button>
          <button data-on={os === "win"} aria-pressed={os === "win"} onClick={() => setOS("win")}>
            Windows
          </button>
        </div>
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            className="cat"
            data-on={c.id === cat}
            aria-pressed={c.id === cat}
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
        <div
          className="toast"
          data-ok={toast.ok}
          // The only feedback that a keystroke actually fired (or that the agent
          // reported a failure) — announce it. Errors are assertive (interrupt),
          // fire confirmations polite.
          role={toast.ok ? "status" : "alert"}
          aria-live={toast.ok ? "polite" : "assertive"}
          aria-atomic="true"
        >
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

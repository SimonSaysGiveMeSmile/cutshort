import { useState } from "react";
import { Palette, Command as CommandIcon } from "lucide-react";
import { ShortcutButton } from "./ShortcutButton";
import { Icon } from "./Icon";
import {
  CATEGORIES,
  SHORTCUTS,
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
  onOpenThemes: () => void;
}

export function ControllerScreen({ os, setOS, state, onOpenThemes }: Props) {
  const [cat, setCat] = useState<CategoryId>("edit");
  const [toast, setToast] = useState<string | null>(null);

  function fire(s: Shortcut) {
    connection.os = os;
    const combo = resolveCombo(s, os);
    connection.fire(combo);
    setToast(`${s.label} · ${comboLabel(combo, os)}`);
    window.clearTimeout((fire as any)._t);
    (fire as any)._t = window.setTimeout(() => setToast(null), 1100);
  }

  const keys = SHORTCUTS.filter((s) => s.category === cat);

  return (
    <>
      <div className="topbar">
        <span className="brand">
          <span className="dot" />
          CutShort
        </span>
        <span className="spacer" />
        <span className="status" data-live={state}>
          <span className="led" />
          {state === "live" ? connection.host : state === "demo" ? "Demo" : "Off"}
        </span>
        <button className="icon-btn" onClick={onOpenThemes} aria-label="Change skin">
          <Palette size={18} strokeWidth={1.7} />
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
        <div className="toast">
          <CommandIcon size={14} strokeWidth={2.2} />
          {toast}
        </div>
      )}
    </>
  );
}

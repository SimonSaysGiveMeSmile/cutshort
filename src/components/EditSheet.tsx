import { useState } from "react";
import { Plus, Trash2, Eye, EyeOff, Check } from "lucide-react";
import { Icon, ICON_NAMES } from "./Icon";
import {
  CATEGORIES,
  comboLabel,
  resolveCombo,
  type CategoryId,
  type ModToken,
  type OS,
} from "../shortcuts";
import {
  addCustom,
  getShortcuts,
  isCustom,
  isHidden,
  removeShortcut,
  restoreBuiltin,
  builtins,
} from "../lib/shortcutStore";

const MODS: ModToken[] = ["MOD", "SHIFT", "ALT", "CTRL", "SUPER"];

interface Props {
  os: OS;
  category: CategoryId;
  onClose: () => void;
}

export function EditSheet({ os, category, onClose }: Props) {
  const [cat, setCat] = useState<CategoryId>(category);
  const [, force] = useState(0); // re-render after store mutations
  const refresh = () => force((n) => n + 1);

  // new-shortcut form
  const [label, setLabel] = useState("");
  const [icon, setIcon] = useState("Zap");
  const [mods, setMods] = useState<ModToken[]>(["MOD"]);
  const [key, setKey] = useState("");

  const current = getShortcuts().filter((s) => s.category === cat);
  const hiddenInCat = builtins.filter((s) => s.category === cat && isHidden(s.id));

  const canAdd = label.trim() && key.trim();
  const previewCombo = { mods, key: key.trim() || "?" };

  function toggleMod(m: ModToken) {
    setMods((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]));
  }

  function add() {
    if (!canAdd) return;
    addCustom({ label: label.trim(), icon, category: cat, combo: { mods, key: key.trim() } });
    setLabel("");
    setKey("");
    setMods(["MOD"]);
    refresh();
  }

  return (
    <>
      <div className="sheet-scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-label="Customize deck">
        <div className="sheet-grip" />
        <h2>Customize deck</h2>

        <div className="cats" style={{ padding: "0 0 12px" }}>
          {CATEGORIES.map((c) => (
            <button key={c.id} className="cat" data-on={c.id === cat} onClick={() => setCat(c.id)}>
              <Icon name={c.icon} size={15} strokeWidth={1.8} />
              {c.label}
            </button>
          ))}
        </div>

        {/* current shortcuts in this category */}
        <div className="edit-list">
          {current.map((s) => (
            <div className="edit-row" key={s.id}>
              <span className="edit-row-ico">
                <Icon name={s.icon} size={18} />
              </span>
              <span className="edit-row-meta">
                <b>{s.label}</b>
                <span>{comboLabel(resolveCombo(s, os), os)}</span>
              </span>
              <button
                className="edit-row-act"
                aria-label={isCustom(s.id) ? "Delete" : "Hide"}
                onClick={() => {
                  removeShortcut(s.id);
                  refresh();
                }}
              >
                {isCustom(s.id) ? <Trash2 size={16} /> : <EyeOff size={16} />}
              </button>
            </div>
          ))}
          {hiddenInCat.map((s) => (
            <div className="edit-row is-hidden" key={s.id}>
              <span className="edit-row-ico">
                <Icon name={s.icon} size={18} />
              </span>
              <span className="edit-row-meta">
                <b>{s.label}</b>
                <span>hidden</span>
              </span>
              <button
                className="edit-row-act"
                aria-label="Restore"
                onClick={() => {
                  restoreBuiltin(s.id);
                  refresh();
                }}
              >
                <Eye size={16} />
              </button>
            </div>
          ))}
        </div>

        {/* add new */}
        <div className="edit-add">
          <div className="edit-add-head">
            <Plus size={15} strokeWidth={2.2} /> New shortcut
          </div>

          <input
            className="input"
            placeholder="Label (e.g. Rename Symbol)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={18}
          />

          <div className="mod-chips">
            {MODS.map((m) => (
              <button key={m} className="mod-chip" data-on={mods.includes(m)} onClick={() => toggleMod(m)}>
                {m === "MOD" ? (os === "mac" ? "⌘ Cmd" : "Ctrl") : m === "SUPER" ? (os === "mac" ? "⌘" : "Win") : m}
              </button>
            ))}
            <input
              className="input key-input"
              placeholder="key (f2, Enter, /)"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>

          <div className="icon-grid">
            {ICON_NAMES.map((n) => (
              <button key={n} className="icon-pick" data-on={n === icon} onClick={() => setIcon(n)} aria-label={n}>
                <Icon name={n} size={20} />
              </button>
            ))}
          </div>

          <div className="edit-add-foot">
            <span className="edit-preview">
              <Icon name={icon} size={18} />
              {label.trim() || "Preview"} · <b>{comboLabel(previewCombo, os)}</b>
            </span>
            <button className="btn primary" disabled={!canAdd} onClick={add}>
              <Check size={16} /> Add
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

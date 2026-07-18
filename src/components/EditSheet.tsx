import { useState, useSyncExternalStore } from "react";
import { Plus, Trash2, Eye, EyeOff, Check, Sparkles } from "lucide-react";
import { Icon, ICON_NAMES } from "./Icon";
import { parseShortcutPhrase, normalizeKeyInput, clampLabel, MAX_LABEL } from "../lib/nlShortcut";
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
  subscribe,
  isCustom,
  isHidden,
  removeShortcut,
  restoreBuiltin,
  builtins,
} from "../lib/shortcutStore";
import { useDialog } from "../lib/dialog";

const MODS: ModToken[] = ["MOD", "SHIFT", "ALT", "CTRL", "SUPER"];

interface Props {
  os: OS;
  category: CategoryId;
  onClose: () => void;
}

export function EditSheet({ os, category, onClose }: Props) {
  const dialogRef = useDialog<HTMLDivElement>(onClose);
  const [cat, setCat] = useState<CategoryId>(category);
  // Subscribe to the store like ControllerScreen does, so the list re-renders on
  // both this sheet's own edits AND a cross-tab change (the `storage` handler
  // notifies subscribers) — a manual force-counter only caught the former.
  const shortcuts = useSyncExternalStore(subscribe, getShortcuts);

  // new-shortcut form
  const [label, setLabel] = useState("");
  const [icon, setIcon] = useState("Zap");
  const [mods, setMods] = useState<ModToken[]>(["MOD"]);
  const [key, setKey] = useState("");
  // natural-language "describe it" box: parses a phrase into the form fields
  const [phrase, setPhrase] = useState("");
  const [hint, setHint] = useState("");

  const current = shortcuts.filter((s) => s.category === cat);
  const hiddenInCat = builtins.filter((s) => s.category === cat && isHidden(s.id));

  // Validate the free-form key against what the agent can actually inject, so the
  // manual path can't persist a deck button that throws `unmapped key` on every tap
  // (the "describe it" box already rejects such keys — this keeps the two in step).
  const normalizedKey = normalizeKeyInput(key);
  const canAdd = label.trim() !== "" && normalizedKey !== null;
  const keyInvalid = key.trim() !== "" && normalizedKey === null;
  const previewCombo = { mods, key: normalizedKey ?? "?" };

  function toggleMod(m: ModToken) {
    setMods((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]));
  }

  // Turn a spoken phrase into the combo fields, leaving icon/category for the
  // user. The manual chips + Add button stay the source of truth — this just
  // fills them, then the same add() persists via addCustom().
  function applyPhrase() {
    const parsed = parseShortcutPhrase(phrase, os);
    if (!parsed) {
      setHint('Add a key too — e.g. "rename symbol f2".');
      return;
    }
    setMods(parsed.mods);
    setKey(parsed.key);
    if (parsed.label) setLabel(clampLabel(parsed.label)); // never exceed the manual cap
    setHint("");
    setPhrase("");
  }

  function add() {
    if (!canAdd || !normalizedKey) return;
    addCustom({ label: clampLabel(label.trim()), icon, category: cat, combo: { mods, key: normalizedKey } });
    setLabel("");
    setKey("");
    setMods(["MOD"]);
  }

  return (
    <>
      <div className="sheet-scrim" onClick={onClose} aria-hidden="true" />
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Customize deck"
        tabIndex={-1}
        ref={dialogRef}
      >
        <div className="sheet-grip" />
        <h2>Customize deck</h2>

        <div className="cats" style={{ padding: "0 0 12px" }}>
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
                onClick={() => removeShortcut(s.id)}
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
                onClick={() => restoreBuiltin(s.id)}
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

          <div className="edit-describe">
            <input
              className="input"
              placeholder="Describe it — “toggle sidebar cmd b”"
              value={phrase}
              onChange={(e) => {
                setPhrase(e.target.value);
                if (hint) setHint("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  applyPhrase();
                }
              }}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              aria-label="Describe a shortcut in words"
              aria-describedby={hint ? "describe-hint" : undefined}
              aria-invalid={hint !== ""}
            />
            <button
              type="button"
              className="edit-describe-btn"
              onClick={applyPhrase}
              disabled={!phrase.trim()}
              aria-label="Fill the form from your description"
            >
              <Sparkles size={15} strokeWidth={2} /> Fill
            </button>
          </div>
          {hint && (
            <div className="edit-describe-hint" id="describe-hint" role="alert">
              {hint}
            </div>
          )}

          <input
            className="input"
            placeholder="Label (e.g. Rename Symbol)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={MAX_LABEL}
          />

          <div className="mod-chips">
            {MODS.map((m) => (
              <button
                key={m}
                className="mod-chip"
                data-on={mods.includes(m)}
                aria-pressed={mods.includes(m)}
                onClick={() => toggleMod(m)}
              >
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
              aria-label="Key"
              aria-invalid={keyInvalid}
            />
          </div>
          {keyInvalid && (
            <div className="edit-describe-hint" role="alert">
              Unknown key — try a letter, a digit, f2, Enter, Space, or /.
            </div>
          )}

          <div className="icon-grid">
            {ICON_NAMES.map((n) => (
              <button
                key={n}
                className="icon-pick"
                data-on={n === icon}
                aria-pressed={n === icon}
                onClick={() => setIcon(n)}
                aria-label={n}
              >
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

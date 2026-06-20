import { applyTheme, THEMES } from "../themes";
import { useDialog } from "../lib/dialog";

interface Props {
  current: string;
  onPick: (id: string) => void;
  onClose: () => void;
}

export function ThemeSheet({ current, onPick, onClose }: Props) {
  const dialogRef = useDialog<HTMLDivElement>(onClose);
  return (
    <>
      <div className="sheet-scrim" onClick={onClose} aria-hidden="true" />
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Choose a theme"
        tabIndex={-1}
        ref={dialogRef}
      >
        <div className="sheet-grip" />
        <h2>Skins</h2>
        <div className="theme-list">
          {THEMES.map((t) => (
            <button
              key={t.id}
              className="theme-card"
              data-on={t.id === current}
              aria-pressed={t.id === current}
              onClick={() => {
                applyTheme(t.id);
                onPick(t.id);
              }}
            >
              <span
                className="theme-swatch"
                style={{
                  background: `linear-gradient(135deg, ${t.swatch[0]}, ${t.swatch[1]})`,
                }}
              />
              <span className="theme-meta">
                <b>{t.name}</b>
                <span>{t.blurb}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

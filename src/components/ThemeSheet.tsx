import { applyTheme, THEMES } from "../themes";

interface Props {
  current: string;
  onPick: (id: string) => void;
  onClose: () => void;
}

export function ThemeSheet({ current, onPick, onClose }: Props) {
  return (
    <>
      <div className="sheet-scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-label="Choose a theme">
        <div className="sheet-grip" />
        <h2>Skins</h2>
        <div className="theme-list">
          {THEMES.map((t) => (
            <button
              key={t.id}
              className="theme-card"
              data-on={t.id === current}
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

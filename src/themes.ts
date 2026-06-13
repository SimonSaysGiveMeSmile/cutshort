// Theme registry. Each theme is purely a `data-theme` value on <html>; all the
// visual weight lives in CSS variables + decorative rules in index.css. The
// registry here just drives the switcher UI and persistence.

export interface Theme {
  id: string;
  name: string;
  blurb: string;
  /** Two swatch colors for the picker chip. */
  swatch: [string, string];
  /** Whether the OS status bar / chrome should read as dark. */
  dark: boolean;
}

export const THEMES: Theme[] = [
  {
    id: "liquid-glass",
    name: "Liquid Glass",
    blurb: "Apple visionOS frost — translucent panels, soft light, depth.",
    swatch: ["#cfe6ff", "#9fb8d8"],
    dark: false,
  },
  {
    id: "stardust",
    name: "Sandblasted Stardust",
    blurb: "Grainy frosted glass over a deep cosmic field.",
    swatch: ["#2a2350", "#b8a9e8"],
    dark: true,
  },
  {
    id: "siri",
    name: "Siri Gradient",
    blurb: "Living mesh of flowing color, like the Siri orb.",
    swatch: ["#ff5ea2", "#5b8cff"],
    dark: true,
  },
  {
    id: "neon",
    name: "Neon Grid",
    blurb: "TRON-dark with electric cyan + magenta glow.",
    swatch: ["#00f0ff", "#ff2bd6"],
    dark: true,
  },
  {
    id: "maxcolor",
    name: "Maxcolor",
    blurb: "Maximalist color blocks, fat borders, loud type.",
    swatch: ["#ff4d2e", "#ffd400"],
    dark: false,
  },
  {
    id: "minimal",
    name: "Minimalist",
    blurb: "Paper-white, hairline rules, nothing wasted.",
    swatch: ["#111111", "#e8e8e8"],
    dark: false,
  },
  {
    id: "clay",
    name: "Clay Soft",
    blurb: "Puffy pastel claymorphism, squishy and tactile.",
    swatch: ["#f7b2c4", "#b8c7f7"],
    dark: false,
  },
  {
    id: "aurora",
    name: "Aurora",
    blurb: "Northern-lights gradients drifting on near-black.",
    swatch: ["#3bf0c4", "#7b5bff"],
    dark: true,
  },
  {
    id: "brutalist",
    name: "Brutalist",
    blurb: "Raw mono, hard edges, zero rounding, all attitude.",
    swatch: ["#000000", "#ffe600"],
    dark: false,
  },
  {
    id: "terminal",
    name: "Terminal",
    blurb: "Phosphor-green CRT with scanlines and a blinking cursor.",
    swatch: ["#0aff7a", "#031108"],
    dark: true,
  },
];

export const DEFAULT_THEME = "liquid-glass";

export function loadTheme(): string {
  if (typeof localStorage === "undefined") return DEFAULT_THEME;
  const saved = localStorage.getItem("cutshort.theme");
  return THEMES.some((t) => t.id === saved) ? (saved as string) : DEFAULT_THEME;
}

export function applyTheme(id: string) {
  document.documentElement.setAttribute("data-theme", id);
  const t = THEMES.find((x) => x.id === id);
  if (t) {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", t.dark ? "#06070a" : "#f2f4f8");
  }
  try {
    localStorage.setItem("cutshort.theme", id);
  } catch {
    /* private mode */
  }
}

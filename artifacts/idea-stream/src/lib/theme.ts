import { useSyncExternalStore } from "react";

export type ThemeMode = "light" | "dark" | "system";
export type Palette = "forest" | "ocean" | "royal" | "sunset" | "rose" | "desert" | "lagoon" | "graphite";
export type ThemeChoice = { mode: ThemeMode; palette: Palette };

/** Read by the startup script in index.html too, so keep the key and shape in step with it. */
export const THEME_KEY = "idea-stream-theme";

type PaletteNumbers = { h: number; s: number; l: number; sd: number; ld: number; t: number; ts: number };

/** Same numbers as the [data-palette] rules in index.css; used here only to draw the swatches. */
const PALETTE_NUMBERS: { id: Palette; en: string; ar: string; n: PaletteNumbers }[] = [
  { id: "forest", en: "Forest", ar: "غابة", n: { h: 157, s: 27, l: 29, sd: 38, ld: 60, t: 42, ts: 33 } },
  { id: "ocean", en: "Ocean", ar: "محيط", n: { h: 208, s: 62, l: 34, sd: 75, ld: 66, t: 205, ts: 28 } },
  { id: "royal", en: "Royal", ar: "ملكي", n: { h: 255, s: 48, l: 44, sd: 80, ld: 74, t: 250, ts: 22 } },
  { id: "sunset", en: "Sunset", ar: "غروب", n: { h: 16, s: 62, l: 45, sd: 78, ld: 64, t: 32, ts: 38 } },
  { id: "rose", en: "Rose", ar: "ورد", n: { h: 338, s: 52, l: 42, sd: 72, ld: 70, t: 345, ts: 26 } },
  { id: "desert", en: "Desert gold", ar: "ذهب الصحراء", n: { h: 36, s: 62, l: 34, sd: 70, ld: 60, t: 40, ts: 34 } },
  { id: "lagoon", en: "Lagoon", ar: "بحيرة", n: { h: 176, s: 58, l: 27, sd: 62, ld: 55, t: 170, ts: 22 } },
  { id: "graphite", en: "Graphite", ar: "جرافيت", n: { h: 220, s: 16, l: 24, sd: 18, ld: 82, t: 220, ts: 12 } },
];

/** Swatches: [background, card, brand] for each mode, matching the formulas in index.css. */
export const PALETTES = PALETTE_NUMBERS.map(({ id, en, ar, n }) => ({
  id, en, ar,
  light: [`hsl(${n.t} ${n.ts}% 97%)`, `hsl(${n.t} 40% 99%)`, `hsl(${n.h} ${n.s}% ${n.l}%)`] as [string, string, string],
  dark: [`hsl(${n.h} 22% 7%)`, `hsl(${n.h} 20% 10.5%)`, `hsl(${n.h} ${n.sd}% ${n.ld}%)`] as [string, string, string],
}));

const DEFAULT: ThemeChoice = { mode: "system", palette: "forest" };
const listeners = new Set<() => void>();
const darkQuery = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

function read(): ThemeChoice {
  try {
    const saved = JSON.parse(localStorage.getItem(THEME_KEY) ?? "null");
    if (saved && ["light", "dark", "system"].includes(saved.mode) && PALETTES.some((p) => p.id === saved.palette)) return saved;
  } catch { /* first visit or blocked storage */ }
  return DEFAULT;
}

let current = typeof window !== "undefined" ? read() : DEFAULT;

export const isDark = (choice: ThemeChoice) => choice.mode === "dark" || (choice.mode === "system" && !!darkQuery?.matches);

/** Applies the choice to <html> and the browser's address-bar colour. */
function apply(choice: ThemeChoice, animate: boolean) {
  const root = document.documentElement;
  if (animate) {
    root.classList.add("theme-switching");
    window.setTimeout(() => root.classList.remove("theme-switching"), 450);
  }
  root.classList.toggle("dark", isDark(choice));
  root.dataset.palette = choice.palette;
  const background = getComputedStyle(root).getPropertyValue("--background").trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", `hsl(${background})`);
}

export function setTheme(next: Partial<ThemeChoice>) {
  current = { ...current, ...next };
  try { localStorage.setItem(THEME_KEY, JSON.stringify(current)); } catch { /* still applies for this visit */ }
  apply(current, true);
  listeners.forEach((listener) => listener());
}

if (typeof window !== "undefined") {
  apply(current, false);
  // "Auto" follows the device as it switches between day and night.
  darkQuery?.addEventListener("change", () => {
    if (current.mode !== "system") return;
    apply(current, true);
    listeners.forEach((listener) => listener());
  });
  // Another tab changed the theme.
  window.addEventListener("storage", (event) => {
    if (event.key !== THEME_KEY) return;
    current = read();
    apply(current, true);
    listeners.forEach((listener) => listener());
  });
}

let snapshot = { ...current, dark: isDark(current) };
export function useTheme() {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    () => {
      const dark = isDark(current);
      if (snapshot.mode !== current.mode || snapshot.palette !== current.palette || snapshot.dark !== dark) snapshot = { ...current, dark };
      return snapshot;
    },
  );
}

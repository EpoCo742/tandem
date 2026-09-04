import { create } from "zustand";

// Per-browser UI preferences. Not part of the session ledger: theme and grid are
// personal choices, so they live in localStorage rather than in shared state.

export type ThemeChoice = "light" | "dark" | "system";
export type GridStyle = "dots" | "lines" | "off";

interface Prefs {
  theme: ThemeChoice;
  resolved: "light" | "dark";
  grid: GridStyle;
  setTheme: (t: ThemeChoice) => void;
  cycleTheme: () => void;
  setGrid: (g: GridStyle) => void;
  cycleGrid: () => void;
}

const KEY = "tandem.prefs";
const mql = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

function load(): { theme: ThemeChoice; grid: GridStyle } {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<{ theme: ThemeChoice; grid: GridStyle }>;
      return {
        theme: p.theme === "light" || p.theme === "dark" || p.theme === "system" ? p.theme : "system",
        grid: p.grid === "dots" || p.grid === "lines" || p.grid === "off" ? p.grid : "dots",
      };
    }
  } catch {
    /* storage unavailable: fall through to defaults */
  }
  return { theme: "system", grid: "dots" };
}

function resolve(theme: ThemeChoice): "light" | "dark" {
  if (theme === "system") return mql?.matches ? "dark" : "light";
  return theme;
}

function apply(theme: ThemeChoice) {
  const resolved = resolve(theme);
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
  root.style.colorScheme = resolved;
  return resolved;
}

function persist(theme: ThemeChoice, grid: GridStyle) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ theme, grid }));
  } catch {
    /* ignore */
  }
}

const initial = load();

export const usePrefs = create<Prefs>((set, get) => ({
  theme: initial.theme,
  resolved: apply(initial.theme),
  grid: initial.grid,
  setTheme: (theme) => {
    persist(theme, get().grid);
    set({ theme, resolved: apply(theme) });
  },
  cycleTheme: () => {
    const order: ThemeChoice[] = ["system", "light", "dark"];
    get().setTheme(order[(order.indexOf(get().theme) + 1) % order.length]!);
  },
  setGrid: (grid) => {
    persist(get().theme, grid);
    set({ grid });
  },
  cycleGrid: () => {
    const order: GridStyle[] = ["dots", "lines", "off"];
    get().setGrid(order[(order.indexOf(get().grid) + 1) % order.length]!);
  },
}));

// Follow the OS while the choice is "system".
mql?.addEventListener("change", () => {
  const { theme } = usePrefs.getState();
  if (theme === "system") usePrefs.setState({ resolved: apply(theme) });
});

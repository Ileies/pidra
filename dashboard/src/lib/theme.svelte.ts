/**
 * The dashboard's colour theme, chosen per device. Storage can be empty or blocked, in which case
 * the app stays dark, which is also the default.
 *
 * The choice is written to `<html data-mode>` and read by the `color-scheme` rules in `app.css`;
 * `system` is left to the browser, so the page follows the OS with no JS in the loop. The inline
 * script in `app.html` applies the stored value before first paint using the same key, so
 * changing `KEY` or the valid values means changing it too (and its hash in `hooks.server.ts`).
 */
export type ThemeMode = "dark" | "light" | "system";

export const THEME_MODES: { value: ThemeMode; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "system", label: "System" },
];

const KEY = "pidra:theme";
const THEME_COLOR = { dark: "#111214", light: "#f0f2f5" };

export const theme = $state<{ mode: ThemeMode }>({ mode: "dark" });

let watching = false;

function isMode(value: unknown): value is ThemeMode {
  return value === "dark" || value === "light" || value === "system";
}

/** The mobile status bar follows `theme-color`, which a meta tag can only set to one value. */
function syncThemeColor(): void {
  const light =
    theme.mode === "light" ||
    (theme.mode === "system" && window.matchMedia("(prefers-color-scheme: light)").matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", light ? THEME_COLOR.light : THEME_COLOR.dark);
}

function apply(): void {
  document.documentElement.dataset.mode = theme.mode;
  syncThemeColor();
}

export function loadTheme(): void {
  try {
    const stored = localStorage.getItem(KEY);
    theme.mode = isMode(stored) ? stored : "dark";
  } catch {
    theme.mode = "dark";
  }
  apply();
  if (!watching) {
    watching = true;
    window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", syncThemeColor);
  }
}

export function setTheme(mode: ThemeMode): void {
  theme.mode = mode;
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // Applies for this visit only.
  }
  apply();
}

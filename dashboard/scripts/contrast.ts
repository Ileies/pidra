/**
 * WCAG 2.1 contrast checker for the dashboard palette.
 *
 * The app is dark-only (DASHBOARD_PLAN decision 2), so there is no second theme to fall back to
 * and every contrast failure is permanent. Run this after any palette edit:
 *
 *   bun run scripts/contrast.ts
 *
 * The pairs below are the ones that actually occur in the UI. Exit code 1 if a text pair drops
 * below 4.5:1, so it can be wired into a check step.
 */

const PALETTE: Record<string, string> = {
  "surface-50": "#f0f2f5",
  "surface-100": "#e8eaef",
  "surface-200": "#d4d6db",
  "surface-300": "#b8bac0",
  "surface-400": "#8b8f9a",
  "surface-500": "#6b7280",
  "surface-600": "#4a4f5a",
  "surface-700": "#2a2d33",
  "surface-800": "#22252a",
  "surface-900": "#1a1c1f",
  "surface-950": "#111214",
  "primary-300": "#8bb4fa",
  "primary-400": "#4f8ef7",
  "primary-500": "#4080f0",
  "primary-700": "#2755aa",
  "primary-800": "#24467f",
  "primary-900": "#1e3a6e",
  "primary-950": "#162d58",
  "success-300": "#6fc79c",
  "success-400": "#5abb8f",
  "success-500": "#4caf82",
  "success-950": "#0f2a1e",
  "warning-300": "#eec050",
  "warning-400": "#e9b036",
  "warning-500": "#e0a020",
  "warning-950": "#2a1e00",
  "error-300": "#ee8888",
  "error-400": "#e96e6e",
  "error-500": "#e05555",
  "error-950": "#2a1010",
};

/**
 * [foreground, background, role]. Text is held to 4.5:1 (WCAG 1.4.3). A `control:` pair is the
 * boundary of an interactive element and is held to 3:1 (WCAG 1.4.11). A `decorative:` pair
 * carries no information on its own - a card separator, a disabled control - and is reported
 * for reference without a threshold.
 */
const PAIRS: [string, string, string][] = [
  ["surface-200", "surface-950", "body copy on the page"],
  ["surface-200", "surface-900", "body copy on a panel"],
  ["surface-400", "surface-950", "muted text on the page"],
  ["surface-400", "surface-900", "muted text on a panel"],
  ["surface-400", "surface-800", "muted text on a raised panel"],
  ["surface-50", "surface-900", "strong text on a panel"],
  ["primary-400", "surface-950", "links"],
  ["primary-400", "surface-900", "links on a panel"],
  ["primary-300", "primary-900", "primary button label"],
  ["primary-300", "primary-950", "active nav button"],
  ["success-400", "success-950", "success badge"],
  ["warning-400", "warning-950", "warning badge"],
  ["error-400", "error-950", "error badge"],
  ["error-400", "surface-900", "error text on a panel"],
  ["error-500", "surface-950", "error text on the page"],
  ["success-500", "surface-900", "score: good"],
  ["warning-500", "surface-900", "score: fair"],
  ["error-500", "surface-900", "score: poor"],
  ["surface-500", "surface-900", "control: input and button border"],
  ["surface-500", "surface-950", "control: input border on the page"],
  ["primary-400", "surface-900", "control: focus ring"],
  ["surface-700", "surface-900", "decorative: card separator"],
  ["surface-600", "surface-900", "decorative: disabled control"],
];

const THRESHOLD = (role: string) =>
  role.startsWith("decorative:") ? 0 : role.startsWith("control:") ? 3 : 4.5;

function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const n = parseInt(hex.replace("#", ""), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(srgbToLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(fg: string, bg: string): number {
  const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

let failures = 0;
const rows = PAIRS.map(([fg, bg, role]) => {
  const threshold = THRESHOLD(role);
  const ratio = contrast(PALETTE[fg], PALETTE[bg]);
  const pass = ratio >= threshold;
  if (!pass) failures++;
  return {
    pair: `${fg} on ${bg}`,
    role,
    ratio: `${ratio.toFixed(2)}:1`,
    need: threshold === 0 ? "-" : `${threshold}:1`,
    ok: threshold === 0 ? "n/a" : pass ? "yes" : "NO",
  };
});

console.table(rows);
if (failures > 0) {
  console.error(`\n${failures} pair(s) below threshold. The palette is dark-only, so these cannot be waived.`);
  process.exit(1);
}
console.log("\nAll pairs pass.");

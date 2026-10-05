/**
 * WCAG 2.1 contrast checker for the dashboard palette, in both modes.
 *
 * The ramps are read from the `--color-*: light-dark(light, dark)` declarations in
 * `src/app.css`, so the check can never drift from the stylesheet. Run it after any palette edit:
 *
 *   bun run scripts/contrast.ts
 *
 * The pairs below are the ones that actually occur in the UI, checked once per mode. Exit code 1
 * if a text pair drops below 4.5:1, so it can be wired into a check step.
 */
import { readFileSync } from "node:fs";

type Palette = Record<string, string>;

const css = readFileSync(new URL("../src/app.css", import.meta.url), "utf8");
const LIGHT: Palette = {};
const DARK: Palette = {};
for (const [, name, light, dark] of css.matchAll(
  /--color-([a-z]+-\d+):\s*light-dark\(\s*(#[0-9a-f]{6})\s*,\s*(#[0-9a-f]{6})\s*\)/gi,
)) {
  LIGHT[name] = light;
  DARK[name] = dark;
}

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
  ["primary-100", "primary-900", "chat: user bubble text"],
  ["primary-400", "primary-950", "control: chat assistant avatar mark"],
  ["surface-700", "surface-900", "decorative: card separator"],
  ["surface-600", "surface-900", "decorative: disabled control"],
];

const missing = PAIRS.flatMap(([fg, bg]) => [fg, bg]).filter((name) => !DARK[name]);
if (missing.length > 0) {
  console.error(`app.css has no light-dark() ramp stop for: ${[...new Set(missing)].join(", ")}`);
  process.exit(1);
}

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
for (const [mode, palette] of [
  ["dark", DARK],
  ["light", LIGHT],
] as const) {
  const rows = PAIRS.map(([fg, bg, role]) => {
    const threshold = THRESHOLD(role);
    const ratio = contrast(palette[fg], palette[bg]);
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
  console.log(`\n${mode} mode`);
  console.table(rows);
}

if (failures > 0) {
  console.error(`\n${failures} pair(s) below threshold. Fix the palette; these cannot be waived.`);
  process.exit(1);
}
console.log("\nAll pairs pass in both modes.");

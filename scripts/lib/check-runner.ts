/**
 * Shared plumbing for `scripts/check.ts` and `dashboard/scripts/check.ts`.
 *
 * Steps run concurrently with their output buffered; a passing step prints one
 * `ok <step> (<secs>s): <last line>` line, a failing one (or a passing one that mentions warnings)
 * prints everything. `--verbose` / `-v` streams every step live instead; `--quick` / `-q` is read
 * by the callers.
 */
export const quick = process.argv.includes("--quick") || process.argv.includes("-q");
export const verbose = process.argv.includes("--verbose") || process.argv.includes("-v");

// With --verbose nothing is buffered: every step streams its full output live, interleaved.
export const q = <T extends { quiet(): T }>(p: T): T => (verbose ? p : p.quiet());

export type Out = { stdout?: Uint8Array; stderr?: Uint8Array };

export const text = (o: Out) =>
  [o.stdout, o.stderr]
    .filter((b): b is Uint8Array => !!b)
    .map((b) => Buffer.from(b).toString().replace(/\x1b\[[0-9;]*m/g, "").trimEnd())
    .filter(Boolean)
    .join("\n");

const hasWarnings = (s: string) => /\b[1-9]\d* warnings?\b|^\s*warn(ing)?s?\b[:\s]|^--- .+ warnings ---/im.test(s);

export async function step(label: string, task: () => Promise<Out>): Promise<boolean> {
  const started = performance.now();
  try {
    const t = text(await task());
    const secs = ((performance.now() - started) / 1000).toFixed(1);
    const last = t.split("\n").map((l) => l.trim()).filter(Boolean).at(-1) ?? "";
    console.log(`ok  ${label} (${secs}s)${last ? `: ${last.slice(0, 100)}` : ""}`);
    if (hasWarnings(t)) console.log(`\n--- ${label} warnings ---\n${t}\n`);
    return true;
  } catch (err) {
    console.error(`\n=== ${label} failed ===`);
    if (!verbose) console.error(text(err as Out) || err);
    return false;
  }
}

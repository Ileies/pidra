#!/usr/bin/env bun
/**
 * File-size budget: `.ts` files stay under 350 lines and `.svelte` files under 250, so a file that
 * keeps growing gets split before it becomes the next refactor. A justified exception goes in
 * `EXCEPTIONS` with its own ceiling, which holds it at today's size instead of exempting it.
 * Run by scripts/check.ts over `git ls-files` (tracked plus untracked, non-ignored). An EXCEPTIONS
 * entry whose file no longer exists fails the check, so delete the entry when a file is removed.
 */
import { $ } from "bun";

const LIMITS: Record<string, number> = { ".ts": 350, ".svelte": 250 };

/** Path to its ceiling, and why it earns one. Lower or delete an entry when the file shrinks. */
const EXCEPTIONS: Record<string, number> = {
  // Synthetic snapshot data: long because the fixture has to cover every mirrored table.
  "dashboard/scripts/blackhole/fixture.ts": 390,
  // One cohesive store (transactions, revisions, search); targeting validation already lives in notes/targeting.ts.
  "src/notes/store.ts": 400,
  // Pure and tested alone, one tree builder; its size is the algorithm.
  "dashboard/src/lib/runTrace.ts": 370,
  // The report page and the run page are mostly markup around one data flow.
  "dashboard/src/routes/[date]/+page.svelte": 345,
  "dashboard/src/routes/runs/[id]/+page.svelte": 314,
};

const files = (await $`git ls-files --cached --others --exclude-standard`.text()).split("\n").filter(Boolean);
const problems: string[] = [];
const seen = new Set<string>();

for (const file of files) {
  const ext = file.slice(file.lastIndexOf("."));
  const limit = LIMITS[ext];
  if (!limit || !(await Bun.file(file).exists())) continue;
  const lines = (await Bun.file(file).text()).split("\n").length - 1;
  const ceiling = EXCEPTIONS[file];
  if (ceiling !== undefined) seen.add(file);
  if (lines > (ceiling ?? limit)) {
    problems.push(`${file}: ${lines} lines, over ${ceiling ?? limit}${ceiling === undefined ? "" : " (its EXCEPTIONS ceiling)"}`);
  }
}

for (const file of Object.keys(EXCEPTIONS)) if (!seen.has(file)) problems.push(`${file}: in EXCEPTIONS but no longer exists`);

if (problems.length > 0) {
  console.error(`File-size budget exceeded (.ts ${LIMITS[".ts"]}, .svelte ${LIMITS[".svelte"]}). Split the file or justify it in scripts/check-file-size.ts:\n${problems.map((p) => `  ${p}`).join("\n")}`);
  process.exit(1);
}
console.log(`file sizes within budget (${files.length} tracked files, ${Object.keys(EXCEPTIONS).length} exceptions)`);

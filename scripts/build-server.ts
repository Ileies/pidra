#!/usr/bin/env bun
/**
 * Bundles what pronix runs outside the dashboard: the skills bridge, the job runner, the deploy's
 * long-term-context probe and the by-hand Keep auth. Output lands in `build/server/` (gitignored), which `scripts/deploy.ts`
 * rsyncs, so the server needs no source tree and no `node_modules`.
 *
 * Dependencies are bundled in (hence every package in package.json is a devDependency: they are
 * build-time inputs). A dependency that reads its own files at run time cannot be bundled this way;
 * the dashboard has one such case (jsdom, patched in dashboard/vite.config.ts).
 * The bundles must stay exactly two directories below the app root: `src/config/data-dir.ts`
 * derives `PROJECT_ROOT` from `import.meta.dir` plus `../..`.
 */
import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const OUT = resolve(ROOT, "build/server");

/** Output file name -> entry point. Names are what `hosts/pronix/pidra.nix` and the deploy invoke. */
const ENTRIES: Record<string, string> = {
  "bridge.js": "src/server/index.ts",
  "job.js": "src/job.ts",
  "verify-context.js": "scripts/verify-context.ts",
  "keep-auth.js": "context-builder/scripts/keep-auth.ts",
};

await rm(OUT, { recursive: true, force: true });

for (const [name, entry] of Object.entries(ENTRIES)) {
  // One build per entry: a shared build would nest the outputs by common ancestor and could not
  // name them, and every process loads exactly one of these anyway.
  const result = await Bun.build({
    entrypoints: [resolve(ROOT, entry)],
    outdir: OUT,
    naming: name,
    target: "bun",
    sourcemap: "linked",
  });
  if (!result.success) {
    for (const log of result.logs) console.error(String(log));
    process.exit(1);
  }
  console.log(`built build/server/${name} (${entry})`);
}

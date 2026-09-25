/**
 * The offline layer's two structural rules (OFFLINE_PLAN.md §14), checked on every `bun run check`
 * because both regress silently: nothing about a hang or a missing tier looks broken on a desktop
 * with the VPN up.
 *
 * 1. **No bare `fetch` in client code.** `$lib/offline/net.ts` is the one caller: it owns the
 *    budgets, tells slow from gone, and keeps the reachability state honest. A `fetch(` anywhere
 *    else in code that runs in the browser is a request that can hang for the OS connect timeout
 *    in the blackhole case, which is how the Questions tap of 2026-09-25 spun for minutes.
 * 2. **Every page is in exactly one offline tier** (`MIRRORED_ROUTES`,
 *    `STATIC_OFFLINE_ROUTES`, or `ONLINE_ONLY` in `src/lib/routes.ts`). A mirrored page has
 *    `ssr = false`; a static offline page is prerendered into the service worker precache.
 *
 *   bun run scripts/check-offline.ts
 */

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { MIRRORED_ROUTES, STATIC_OFFLINE_ROUTES, ONLINE_ONLY } from "../src/lib/routes.ts";

const ROOT = join(import.meta.dir, "..", "src");
const ROUTES_DIR = join(ROOT, "routes");
const errors: string[] = [];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function stripComments(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

// --- 1. no bare fetch in client code ---

const SERVER_ONLY = [
  /^lib\/server\//,
  /(^|\/)\+server\.ts$/,
  /(^|\/)\+(page|layout)\.server\.ts$/,
  /^hooks\.server\.ts$/,
  // The worker has its own budgets and never runs `net.ts`: it is a separate global scope.
  /^service-worker\.ts$/,
];
const ALLOWED = new Set(["lib/offline/net.ts"]);
const BARE_FETCH = /(^|[^\w$.])fetch\s*\(|\b(window|globalThis|self)\.fetch\s*\(/;

for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file).split(sep).join("/");
  if (!/\.(ts|js|svelte)$/.test(rel) || rel.endsWith(".d.ts")) continue;
  if (ALLOWED.has(rel) || SERVER_ONLY.some((pattern) => pattern.test(rel))) continue;

  const lines = stripComments(readFileSync(file, "utf8")).split("\n");
  lines.forEach((line, index) => {
    if (BARE_FETCH.test(line)) {
      errors.push(`src/${rel}:${index + 1}: bare fetch in client code; use net()/netJson() from $lib/offline/net.ts (or move server-only code under $lib/server)`);
    }
  });
}

// --- 2. every page in exactly one tier ---

const pageDirs = walk(ROUTES_DIR)
  .filter((file) => file.endsWith(`${sep}+page.svelte`) || file.endsWith(`${sep}+page.ts`))
  .map((file) => file.slice(0, file.lastIndexOf(sep)));

for (const dir of [...new Set(pageDirs)].sort()) {
  const rel = relative(ROUTES_DIR, dir).split(sep).join("/");
  const id = rel === "" ? "/" : `/${rel}`;
  const mirrored = MIRRORED_ROUTES.has(id);
  const staticOffline = STATIC_OFFLINE_ROUTES.has(id);
  const onlineOnly = id in ONLINE_ONLY;

  if (Number(mirrored) + Number(staticOffline) + Number(onlineOnly) !== 1) {
    errors.push(`${id}: must be in exactly one offline tier (src/lib/routes.ts)`);
  }
  if (staticOffline) {
    const universal = join(dir, "+page.ts");
    if (!existsSync(universal) || !/export\s+const\s+prerender\s*=\s*true/.test(readFileSync(universal, "utf8"))) {
      errors.push(`${id}: static offline page must export prerender = true in +page.ts`);
    }
    if (existsSync(join(dir, "+page.server.ts"))) errors.push(`${id}: static offline page cannot have a server load`);
  }
  if (!mirrored) continue;

  const universal = join(dir, "+page.ts");
  if (!existsSync(universal) || !/export\s+const\s+ssr\s*=\s*false/.test(readFileSync(universal, "utf8"))) {
    errors.push(`${id}: mirrored but its +page.ts does not export ssr = false, so its HTML is not the route-agnostic shell`);
  }
  const server = join(dir, "+page.server.ts");
  if (existsSync(server) && /export\s+(const|async\s+function|function)\s+load\b/.test(readFileSync(server, "utf8"))) {
    errors.push(`${id}: mirrored but +page.server.ts still has a load, which needs the network on every navigation`);
  }
}

for (const id of [...MIRRORED_ROUTES, ...STATIC_OFFLINE_ROUTES, ...Object.keys(ONLINE_ONLY)]) {
  const dir = id === "/" ? ROUTES_DIR : join(ROUTES_DIR, ...id.slice(1).split("/"));
  if (!existsSync(join(dir, "+page.svelte")) && !existsSync(join(dir, "+page.ts"))) {
    errors.push(`${id}: listed in src/lib/routes.ts but no such page exists`);
  }
}

if (errors.length > 0) {
  console.error(`check-offline: ${errors.length} problem(s)\n`);
  for (const error of errors) console.error(`  ${error}`);
  process.exit(1);
}
console.log("check-offline: no bare fetch in client code, every page in exactly one offline tier");

/**
 * Guard: every dashboard page has a surface, and it is the one the pipeline thinks it has.
 *
 * `src/ai/surfaces.ts` decides what the assistant may do on a page, and it decides it from the
 * route. An unmatched route falls back to `global` - which is the correct failure mode for an
 * unknown URL, and the wrong one for a page that simply was not added to the map. That is a
 * capability decision made by omission, and it is silent.
 *
 * The dashboard's route registry (`dashboard/src/lib/routes.ts`) is the list of pages. This
 * checks each entry's declared surface against what `surfaceForRoute` actually resolves, so
 * adding a page to the registry and forgetting the pipeline's map fails the build instead.
 *
 * The registry is parsed rather than imported: it is a SvelteKit module in a separate package
 * with `$lib` aliases, and this script has no business booting Vite to read a list of strings.
 *
 * Wired into `bun run check`. See DASHBOARD_PLAN.md S11 / B3.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { surfaceForRoute, SURFACES_LIST, type Surface } from "../src/ai/surfaces";

const REGISTRY = join(import.meta.dir, "../dashboard/src/lib/routes.ts");

interface Entry {
  href: string;
  surface: string;
}

/**
 * Pulls `href` and `surface` out of each object literal in the exported ROUTES array. Deliberately
 * dumb: if the registry ever stops being a flat array of literals, this fails loudly rather than
 * quietly matching nothing.
 */
function parseRegistry(source: string): Entry[] {
  const start = source.indexOf("export const ROUTES");
  if (start === -1) throw new Error("routes.ts no longer exports ROUTES");

  const entries: Entry[] = [];
  const objectRe = /\{\s*href:\s*"([^"]+)",[\s\S]*?surface:\s*"([^"]+)"/g;
  for (const match of source.slice(start).matchAll(objectRe)) {
    entries.push({ href: match[1], surface: match[2] });
  }
  return entries;
}

const entries = parseRegistry(readFileSync(REGISTRY, "utf8"));

if (entries.length === 0) {
  console.error("check-route-surfaces: parsed no entries from the route registry. The parser is stale.");
  process.exit(1);
}

const problems: string[] = [];

for (const entry of entries) {
  if (!(SURFACES_LIST as readonly string[]).includes(entry.surface)) {
    problems.push(`${entry.href}: declares surface "${entry.surface}", which is not a surface`);
    continue;
  }

  const resolved = surfaceForRoute(entry.href);
  if (resolved !== (entry.surface as Surface)) {
    problems.push(
      `${entry.href}: registry says "${entry.surface}", src/ai/surfaces.ts resolves "${resolved}".` +
        (resolved === "global"
          ? " A page missing from ROUTE_SURFACES falls back to global, which is a capability decision made by omission."
          : ""),
    );
  }
}

if (problems.length > 0) {
  console.error(`\ncheck-route-surfaces: ${problems.length} route(s) disagree between the dashboard registry and the surface map:\n`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error("\nFix src/ai/surfaces.ts ROUTE_SURFACES, or the surface on the registry entry.\n");
  process.exit(1);
}

console.log(`check-route-surfaces: ${entries.length} routes, all surfaces agree.`);

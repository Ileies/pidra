/**
 * Guard: every dashboard page has a surface, and it is the one the pipeline thinks it has.
 *
 * `src/ai/surfaces.ts` picks what the assistant may do on a page from the route, and an unmatched
 * route silently falls back to `global`. This compares each entry of the dashboard registry
 * (`dashboard/src/lib/routes.ts`) with what `surfaceForRoute` resolves, and checks that every
 * registered skill is on a surface and every surface carries EVERYWHERE_SKILLS (and
 * INTERACTIVE_SKILLS, except `questions`).
 *
 * The registry is parsed as text, not imported: it is a SvelteKit module with `$lib` aliases.
 *
 * Run by scripts/check.ts (`bun run check`); exits 1 on any disagreement.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { EVERYWHERE_SKILLS, INTERACTIVE_SKILLS, SURFACES, surfaceForRoute, SURFACES_LIST, type Surface } from "../src/ai/surfaces";
import { listSkills } from "../src/skills/loader";

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

// Skill coverage: a skill the assistant cannot see answers "I can't do that" for something the
// system can. Every registered skill is on at least one surface.
const registered = listSkills().map((s) => s.name);
const onSomeSurface = new Set(Object.values(SURFACES).flatMap((s) => s.skills));
const coverage: string[] = [];

for (const name of registered) {
  if (!onSomeSurface.has(name)) coverage.push(`${name}: registered, but on no surface`);
}
for (const name of [...EVERYWHERE_SKILLS, ...INTERACTIVE_SKILLS, ...onSomeSurface]) {
  if (!registered.includes(name)) coverage.push(`${name}: named in src/ai/surfaces.ts but not registered in the skill loader`);
}
for (const [surface, def] of Object.entries(SURFACES)) {
  for (const name of EVERYWHERE_SKILLS) {
    if (!def.skills.includes(name)) coverage.push(`${surface}: missing ${name}, which every surface carries`);
  }
  for (const name of INTERACTIVE_SKILLS) {
    const has = def.skills.includes(name);
    if (surface === "questions" && has) coverage.push(`questions: carries ${name}, but its turns run unattended on untrusted mail text`);
    if (surface !== "questions" && !has) coverage.push(`${surface}: missing ${name}, which every surface but questions carries`);
  }
}

if (coverage.length > 0) {
  console.error(`\ncheck-route-surfaces: ${coverage.length} skill coverage problem(s):\n`);
  for (const problem of [...new Set(coverage)]) console.error(`  - ${problem}`);
  console.error("\nFix src/ai/surfaces.ts (or register the skill in src/skills/loader.ts).\n");
  process.exit(1);
}

console.log(
  `check-route-surfaces: ${entries.length} routes, all surfaces agree; ${registered.length} skills, all on a surface.`,
);

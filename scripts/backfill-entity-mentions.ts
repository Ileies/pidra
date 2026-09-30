/**
 * Stage 1.4 of docs/todo/entities.md: reconstruct `entity_mentions` from stored history and
 * correct `entities.mention_count` / `last_mentioned` to match it.
 *
 * Source data: every newsletter's `entities_graph` (`extractions.extracted_json`, deduped to one
 * per `raw_item_id` - the live writer's bug was counting once per claim instead). This is exactly
 * what `src/pipeline/phase6/entities.ts` reads today, so a backfilled count and a freshly-written
 * one are reproduced the same way.
 *
 * Deliberately excludes `context_builder_indexed_items`. `seedEntities()` only ever contributes a
 * mention count once, at the moment an entity is first created, from whatever the corpus looked
 * like then, and never revisits an existing row - that contribution is already correctly baked
 * into the entity's current `mention_count`, so there is no bug to backfill there. Reconstructing
 * it from the full, ever-growing indexed-items corpus instead would count every incidental
 * appearance of a name (the owner's own name in an email signature, a CI bot's notification
 * footer) as a fresh "mention" of a topic entity, inflating exactly the entities that show up
 * most in personal email regardless of whether they are ever worth surfacing in a briefing - and
 * it would do so without an `entity_mentions` row to justify it going forward, which breaks the
 * invariant the mentions table exists to guarantee: `mention_count` only ever moves alongside a
 * mention row that was actually inserted.
 *
 * Only ever touches `mention_count`, `last_mentioned` and `entity_mentions` - never `type`,
 * `domain`, `summary`, `importance` or `status`, so a `revise_context`-locked row is untouched
 * regardless of `locked`. An entity with no reconstructed history is left exactly as it is: no
 * reconstruction found does not mean no real mentions ever happened.
 *
 * Does not create or merge entity rows. Names in the history with no matching current row are
 * reported as unmatched, and case-insensitive duplicate canonical names among current rows are
 * reported as collisions - both need a human decision, not an automated merge.
 *
 *   bun run scripts/backfill-entity-mentions.ts           # report only
 *   bun run scripts/backfill-entity-mentions.ts --apply   # write
 */

import { SQL } from "bun";
import { normalizeEntityKey } from "../src/util/entities";

const apply = process.argv.includes("--apply");
const db = new SQL(process.env.DATABASE_URL!);

interface EntityRow {
  id: string;
  name: string;
  mention_count: number | null;
  last_mentioned: string | null;
  locked: boolean;
}

const entityRows = (await db`
  SELECT id, name, mention_count, last_mentioned::text AS last_mentioned, locked FROM entities
`) as unknown as EntityRow[];

const byKey = new Map<string, EntityRow>();
const collisions: [string, string][] = [];
for (const row of entityRows) {
  const key = normalizeEntityKey(row.name);
  const existing = byKey.get(key);
  if (existing) {
    collisions.push([existing.name, row.name]);
    continue;
  }
  byKey.set(key, row);
}

interface Ref { sourceKind: string; date: string | null }
const refsByKey = new Map<string, Map<string, Ref>>();
const unmatched = new Set<string>();

function addRef(rawName: string, sourceKind: string, sourceRef: string, date: string | null) {
  const name = String(rawName).trim();
  if (!name) return;
  const key = normalizeEntityKey(name);
  if (!byKey.has(key)) {
    unmatched.add(name);
    return;
  }
  let m = refsByKey.get(key);
  if (!m) {
    m = new Map();
    refsByKey.set(key, m);
  }
  if (!m.has(sourceRef)) m.set(sourceRef, { sourceKind, date });
}

// One row per newsletter (`raw_item_id`), across every run date - this is the dedupe the live
// Phase 6 writer now does per run; doing it here across all history is what makes the backfilled
// count match what the writer would have produced if it had always deduped this way.
const newsletterRows = (await db`
  SELECT DISTINCT ON (e.raw_item_id) e.raw_item_id AS raw_item_id, e.extracted_json AS extracted_json,
         ri.run_date::text AS run_date
  FROM extractions e
  JOIN raw_items ri ON ri.id = e.raw_item_id
  WHERE ri.source_type = 'newsletter' AND e.extracted_json -> 'entities_graph' IS NOT NULL
  ORDER BY e.raw_item_id, e.run_date
`) as unknown as { raw_item_id: string; extracted_json: any; run_date: string }[];

for (const row of newsletterRows) {
  const graph = row.extracted_json?.entities_graph;
  for (const ent of (graph?.entities ?? []) as { name?: string }[]) {
    if (ent?.name) addRef(ent.name, "newsletter", row.raw_item_id, row.run_date);
  }
}

interface Diff { entity: EntityRow; correctCount: number; correctLast: string | null; refs: Map<string, Ref> }
const diffs: Diff[] = [];
let untouched = 0;

for (const [key, entity] of byKey) {
  const refs = refsByKey.get(key);
  if (!refs || refs.size === 0) {
    untouched++;
    continue;
  }
  let correctLast: string | null = null;
  for (const ref of refs.values()) {
    if (ref.date && (!correctLast || ref.date > correctLast)) correctLast = ref.date;
  }
  const correctCount = refs.size;
  if (correctCount !== (entity.mention_count ?? 0) || correctLast !== entity.last_mentioned) {
    diffs.push({ entity, correctCount, correctLast, refs });
  }
}

diffs.sort((a, b) => Math.abs((b.correctCount - (b.entity.mention_count ?? 0))) - Math.abs((a.correctCount - (a.entity.mention_count ?? 0))));

console.log(`${entityRows.length} entities, ${diffs.length} would change, ${entityRows.length - diffs.length - untouched} already correct, ${untouched} with no reconstructed history (left untouched)`);
console.log(`${collisions.length} case-insensitive canonical-name collision(s), ${unmatched.size} unmatched historical name(s)`);

for (const d of diffs.slice(0, 40)) {
  const tag = d.entity.locked ? " [locked]" : "";
  console.log(`  ${d.entity.name}${tag}: mention_count ${d.entity.mention_count ?? 0} -> ${d.correctCount}, last_mentioned ${d.entity.last_mentioned ?? "null"} -> ${d.correctLast ?? "null"}`);
}
if (diffs.length > 40) console.log(`  ...and ${diffs.length - 40} more`);

const lockedDiffs = diffs.filter((d) => d.entity.locked);
if (lockedDiffs.length > 0) {
  console.log(`\n${lockedDiffs.length} locked (corrected) entity(ies) affected - only mention_count/last_mentioned change, never the corrected fields:`);
  for (const d of lockedDiffs) {
    console.log(`  ${d.entity.name}: mention_count ${d.entity.mention_count ?? 0} -> ${d.correctCount}, last_mentioned ${d.entity.last_mentioned ?? "null"} -> ${d.correctLast ?? "null"}`);
  }
}

if (collisions.length > 0) {
  console.log("\nCollisions (first row kept, second needs a manual merge decision):");
  for (const [kept, dropped] of collisions) console.log(`  "${kept}" / "${dropped}"`);
}

if (apply) {
  for (const d of diffs) {
    await db`UPDATE entities SET mention_count = ${d.correctCount}, last_mentioned = ${d.correctLast} WHERE id = ${d.entity.id}`;
  }
  // Mentions are written for every matched entity, not just the ones whose cached count changed:
  // the table starts empty, so an entity whose count already happened to be right still needs
  // its provenance rows.
  let mentionsWritten = 0;
  for (const [key, entity] of byKey) {
    const refs = refsByKey.get(key);
    if (!refs) continue;
    for (const [sourceRef, ref] of refs) {
      const [result] = await db`
        INSERT INTO entity_mentions (entity_id, source_kind, source_ref, mention_date)
        VALUES (${entity.id}, ${ref.sourceKind}, ${sourceRef}, ${ref.date})
        ON CONFLICT DO NOTHING
        RETURNING id
      `;
      if (result) mentionsWritten++;
    }
  }
  console.log(`\nApplied: ${diffs.length} entity count(s) corrected, ${mentionsWritten} mention row(s) written.`);
} else {
  console.log("\nDry run. Pass --apply to write.");
}

await db.end();

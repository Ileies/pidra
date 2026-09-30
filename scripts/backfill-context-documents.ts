/**
 * One-off backfill: populate `context_builder_runs.document` from the archival JSON file each
 * row's `output_path` still points at, for rows written before the `document` column existed.
 *
 * Run this on whichever machine can actually open the file - `output_path` is an absolute path
 * recorded by whichever machine ran that harvest, and `readDocument` only falls back to a local
 * `context-builder/output/<basename>` guess, not to a remote one. Re-runnable: it only ever
 * touches rows where `document IS NULL`, so running it again after a harvest moves between
 * machines just picks up whatever it can newly reach.
 *
 *   bun run scripts/backfill-context-documents.ts          # report only
 *   bun run scripts/backfill-context-documents.ts --write  # apply
 */

import { SQL } from "bun";
import { readDocument } from "../src/pipeline/long-term-context";

const write = process.argv.includes("--write");
const db = new SQL(process.env.DATABASE_URL!);

const rows = (await db`
  SELECT id, started_at::text AS started_at, output_path
  FROM context_builder_runs
  WHERE status = 'completed' AND document IS NULL AND output_path IS NOT NULL
  ORDER BY started_at
`) as unknown as { id: string; started_at: string; output_path: string }[];

let backfilled = 0;
let unreadable = 0;

for (const row of rows) {
  let document: unknown;
  try {
    document = JSON.parse(await readDocument(row.output_path));
  } catch (err) {
    unreadable++;
    console.warn(`  ${row.started_at} (${row.id}): ${row.output_path} unreadable here (${err instanceof Error ? err.message : String(err)})`);
    continue;
  }

  console.log(`  ${row.started_at} (${row.id}): ${row.output_path}`);
  if (write) {
    // The object goes over as-is - see src/db/jsonb.ts for why a pre-stringified value would
    // double-encode into a JSON string scalar instead of a real jsonb object.
    await db`UPDATE context_builder_runs SET document = ${document as object} WHERE id = ${row.id}`;
  }
  backfilled++;
}

console.log(`\n${backfilled} backfilled, ${unreadable} unreadable here, of ${rows.length} legacy row(s).`);
if (!write) console.log("Dry run. Pass --write to apply.");

await db.end();

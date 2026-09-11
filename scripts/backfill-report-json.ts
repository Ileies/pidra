/**
 * One-off backfill: parse every existing `daily_reports.full_report` into `report_json`.
 *
 * Cheap, and it means the archive is not split into a pre-JSON and a post-JSON era - the report
 * page and, later, the archive list behave the same on day one as on day sixty.
 *
 *   bun run scripts/backfill-report-json.ts          # report only
 *   bun run scripts/backfill-report-json.ts --write  # apply
 *
 * Re-runnable: it rewrites every row it can parse, so it is also the way to re-derive the column
 * after a parser fix. `full_report` is never touched.
 */

import { SQL } from "bun";
import { parseReport } from "../src/pipeline/report-json";

const write = process.argv.includes("--write");
const db = new SQL(process.env.DATABASE_URL!);

const rows = (await db`
  SELECT report_date::text AS report_date, full_report
  FROM daily_reports
  WHERE full_report IS NOT NULL
  ORDER BY report_date
`) as unknown as { report_date: string; full_report: string }[];

let parsed = 0;
let failed = 0;

for (const row of rows) {
  const json = parseReport(row.full_report, row.report_date);
  if (!json) {
    failed++;
    console.warn(`  ${row.report_date}: no section headings found - left as null`);
    continue;
  }

  const counts = [
    `${json.personal.reduce((sum, group) => sum + group.entries.length, 0)} personal`,
    `${json.intel.reduce((sum, group) => sum + group.entries.length, 0)} intel in ${json.intel.length} domains`,
    `${json.alsoNoted.length} also-noted`,
  ].join(", ");
  console.log(`  ${row.report_date}: ${counts}`);

  if (write) {
    // The object goes over as-is: Bun's SQL driver serialises it exactly once. Passing a
    // pre-stringified value would store a JSON *string* scalar instead of an object, which is
    // the double-encoding bug src/db/jsonb.ts exists to avoid.
    await db`UPDATE daily_reports SET report_json = ${json} WHERE report_date = ${row.report_date}`;
  }
  parsed++;
}

console.log(`\n${parsed} parsed, ${failed} left null, of ${rows.length} reports.`);
if (!write) console.log("Dry run. Pass --write to apply.");

await db.end();

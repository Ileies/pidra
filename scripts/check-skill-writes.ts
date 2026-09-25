/**
 * Guard: no skill may write a report.
 *
 * Reports are final. `daily_reports`, `extractions`, `raw_items` and `active_topics` belong to the
 * pipeline and to Phase 6's `<!--SYSTEM-->` parsing; a skill - and therefore the assistant, which
 * can only act through skills - may read them and nothing more. Reading is fine and `read_report`
 * depends on it, so this looks for writes specifically, both through Drizzle and in raw SQL.
 *
 * Wired into `bun run check`.
 */

import { readdirSync } from "fs";
import { join } from "path";

const SKILLS_DIR = join(import.meta.dir, "../skills");

/** Drizzle table object, and the SQL table name for raw statements. */
const PROTECTED: [string, string][] = [
  ["dailyReports", "daily_reports"],
  ["extractions", "extractions"],
  ["rawItems", "raw_items"],
  ["activeTopics", "active_topics"],
  // The quick actions a report offers are the pipeline's proposals and the owner's taps, never
  // the assistant's: `src/actions/store.ts` is the only writer.
  ["reportActions", "report_actions"],
];

interface Violation {
  file: string;
  line: number;
  text: string;
}

const violations: Violation[] = [];

for (const file of readdirSync(SKILLS_DIR).filter((f) => f.endsWith(".ts"))) {
  const lines = (await Bun.file(join(SKILLS_DIR, file)).text()).split("\n");

  lines.forEach((line, index) => {
    // Comments describing the rule are not violations of it.
    const code = line.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "");

    for (const [table, sqlName] of PROTECTED) {
      const drizzleWrite = new RegExp(`\\.(insert|update|delete)\\(\\s*${table}\\b`);
      const rawWrite = new RegExp(`(insert\\s+into|update|delete\\s+from)\\s+${sqlName}\\b`, "i");
      if (drizzleWrite.test(code) || rawWrite.test(code)) {
        violations.push({ file, line: index + 1, text: line.trim() });
      }
    }
  });
}

if (violations.length > 0) {
  console.error("Reports are final: a skill must never write a report table.\n");
  for (const violation of violations) {
    console.error(`  skills/${violation.file}:${violation.line}  ${violation.text}`);
  }
  console.error("\nWrite a note, a todo or a context correction instead. See \"Reports are final\" in CLAUDE.md.");
  process.exit(1);
}

console.log(`check-skill-writes: ok, no skill writes a report table (${PROTECTED.map(([, n]) => n).join(", ")})`);

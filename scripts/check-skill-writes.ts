/**
 * Guard: no skill may write a report.
 *
 * Reports are final (docs/architecture-rules.md). The PROTECTED tables belong to the pipeline; skills
 * (and so the assistant) may read them, which `read_report` depends on, but not write. Scans
 * skills/*.ts for Drizzle `.insert/.update/.delete(table)` and raw SQL writes, ignoring comments.
 *
 * Run by scripts/check.ts (`bun run check`).
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
  // Quick actions: `src/actions/store.ts` is the only writer.
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
    // Strip comments (line-based, so block-comment bodies must start with `*`).
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

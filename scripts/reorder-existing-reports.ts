import { db, dailyReports } from "../src/db";
import { eq } from "drizzle-orm";

const DIVIDER = "\n\n---\n\n";
const INTELLIGENCE = "## Intelligence Briefing";
const PERSONAL = "## Personal Action Center";

function reorderReport(report: string): string | null {
  const normalized = report.replace(
    /^(## (?:Personal Action Center|Intelligence Briefing)) - Date not provided$/gm,
    "$1",
  );
  const parts = normalized.split(DIVIDER);
  if (
    parts.length === 3 &&
    parts[1].startsWith(INTELLIGENCE) &&
    parts[2].startsWith(PERSONAL)
  ) {
    return [parts[0], parts[2], parts[1]].join(DIVIDER);
  }
  return normalized === report ? null : normalized;
}

const reports = await db
  .select({ id: dailyReports.id, fullReport: dailyReports.fullReport })
  .from(dailyReports);

let reordered = 0;
let unchanged = 0;
for (const report of reports) {
  if (!report.fullReport) {
    unchanged++;
    continue;
  }
  const reorderedReport = reorderReport(report.fullReport);
  if (!reorderedReport) {
    unchanged++;
    continue;
  }
  await db
    .update(dailyReports)
    .set({ fullReport: reorderedReport })
    .where(eq(dailyReports.id, report.id));
  reordered++;
}

console.log(`Updated ${reordered} report(s); left ${unchanged} unchanged.`);

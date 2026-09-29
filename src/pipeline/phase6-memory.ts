import { db, dailyReports, extractions } from "../db";
import { eq, inArray } from "drizzle-orm";
import type { SynthesisResult } from "./phase5-synthesis";
import { parseReport } from "./report-json";
import { resolveReportRefs } from "./phase6/refs";
import { parseSystemBlock, applySection1SystemBlock, applySection2SystemBlock } from "./phase6/system-block";
import { writeSourceDailyScores } from "./phase6/source-scoring";
import { upsertEntitiesFromExtractions } from "./phase6/entities";
import { markDormantEntities } from "./phase6/dormant";
import { incrementContactEmailCounts } from "./phase6/contacts";

export async function runPhase6(
  runDate: string,
  synthesis: SynthesisResult,
  itemCount: number,
  itemsIncluded: number,
  questionGateFired = false,
  webSearchesRun = 0,
): Promise<string> {
  console.log("[Phase 6] Writing memory and report");

  // Personal first, then the News section, then the newsletter briefing: what needs acting on,
  // then what happened, then the depth. A day without news simply has one section fewer.
  const sections = [synthesis.section2, synthesis.news, synthesis.section1].filter((s) => s.trim() !== "");
  const rawReport = `# Morning Briefing - ${runDate}\n\n---\n\n${sections.join("\n\n---\n\n")}`;
  const { report: fullReport, includedIds } = await resolveReportRefs(rawReport, runDate);

  // `included_in_report` is the ground truth for source trust: which items actually reached
  // the user, not which ones merely scored well. Reset first so a re-run of this phase is
  // idempotent rather than cumulative.
  await db.update(extractions).set({ includedInReport: false }).where(eq(extractions.runDate, runDate));
  if (includedIds.length > 0) {
    await db.update(extractions).set({ includedInReport: true }).where(inArray(extractions.id, includedIds));
  }

  // The caller only knows how many items were handed to synthesis. Now that the refs are
  // resolved, the real figure is available; fall back to the caller's estimate if the model
  // emitted no usable anchors at all.
  const refsUsable = includedIds.length > 0;
  const reportItemsIncluded = refsUsable ? includedIds.length : itemsIncluded;

  // The structured form of the report, parsed from the markdown the model just produced. No
  // second AI call: the shape is fixed by the synthesis prompts, so this is a heading walk.
  // A parse failure means the prompt and the parser have drifted; the column stays null and the
  // dashboard renders the markdown as before rather than showing an empty page.
  const reportJson = parseReport(fullReport, runDate);
  if (!reportJson) {
    console.warn("[Phase 6] Report did not parse into report_json - the dashboard will fall back to markdown");
  }

  // Write daily report
  await db.insert(dailyReports).values({
    reportDate: runDate,
    fullReport,
    reportJson,
    shortSummary: synthesis.section1.split("\n").slice(0, 5).join(" ").slice(0, 500),
    itemCount,
    itemsIncluded: reportItemsIncluded,
    itemsFiltered: itemCount - reportItemsIncluded,
    tokensIn: synthesis.tokensIn,
    tokensOut: synthesis.tokensOut,
    aiCalls: synthesis.aiCalls,
    questionGateFired,
    webSearchesRun,
  }).onConflictDoUpdate({
    target: dailyReports.reportDate,
    set: {
      fullReport,
      reportJson,
      shortSummary: synthesis.section1.slice(0, 500),
      tokensIn: synthesis.tokensIn,
      tokensOut: synthesis.tokensOut,
    },
  });

  // Parse and apply Section 1 SYSTEM block
  const s1System = parseSystemBlock(synthesis.section1);
  if (s1System) await applySection1SystemBlock(s1System, runDate);

  // Parse and apply Section 2 SYSTEM block
  const s2System = parseSystemBlock(synthesis.section2);
  if (s2System) await applySection2SystemBlock(s2System);

  await writeSourceDailyScores(runDate, refsUsable);
  await upsertEntitiesFromExtractions(runDate);
  await markDormantEntities(runDate);
  await incrementContactEmailCounts(runDate);

  console.log("[Phase 6] Done");
  return fullReport;
}

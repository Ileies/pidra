/**
 * Tunes the quick actions without a pipeline run.
 *
 *   bun run scripts/actions-dry-run.ts [YYYY-MM-DD]
 *
 * Runs the quick-actions agent for real over the personal mail of that date's run - one model
 * call, what a morning's quick actions cost - and prints every proposal: what the button would
 * say and what a tap would send, or why the code threw it out. Stores nothing and runs nothing.
 * The date must already have been through Phase 3, since the candidates are read by gate verdict.
 *
 * It reads the database (extractions, the calendar and task snapshot, notes, standing rules) and
 * Google Calendar, so on a machine off the LAN it needs the tunnel from CLAUDE.md.
 */

import { and, eq, isNull } from "drizzle-orm";
import { db, notes, rawItems } from "../src/db";
import { proposeQuickActions } from "../src/actions/propose";
import type { CalendarEvent } from "../src/ingest/google";
import { loadLongTermContext } from "../src/pipeline/long-term-context";

const date = process.argv.slice(2).find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? new Date().toISOString().split("T")[0];

const [calendarRows, noteRows, longTermContext] = await Promise.all([
  db
    .select({ rawContent: rawItems.rawContent })
    .from(rawItems)
    .where(and(eq(rawItems.runDate, date), eq(rawItems.sourceType, "calendar"))),
  db.select().from(notes).where(isNull(notes.deletedAt)),
  loadLongTermContext(),
]);

const calendarItems = calendarRows.flatMap((r) => {
  try {
    return [JSON.parse(r.rawContent ?? "") as CalendarEvent];
  } catch {
    return [];
  }
});

const result = await proposeQuickActions(
  {
    calendarItems,
    notesPersonal: noteRows.filter((n) => n.scope === "personal" || n.scope === "global"),
    longTermContext,
  },
  date,
);

console.log(`\n${date}: ${result.proposals.length} proposal(s), ${result.tokensIn} tokens in, ${result.tokensOut} out\n`);
for (const p of result.proposals) {
  console.log(`${p.discarded ? `DISCARDED (${p.discarded})` : "OFFERED"}  ${p.kind}  "${p.preview.title}"`);
  console.log(`  why:    ${p.reason}`);
  console.log(`  ${p.discarded ? "model: " : "sends: "} ${p.skillName} ${JSON.stringify(p.parameters)}`);
  console.log(`  mails:  ${p.sourceExtractionIds.join(", ")}\n`);
}

process.exit(0);

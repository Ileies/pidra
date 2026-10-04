import { and, eq, inArray } from "drizzle-orm";
import { db, extractions, rawItems } from "../../db";
import { parseJsonRows } from "../../util/json";
import type { TodoItem } from "../../ingest/google";
import { stripControlChars } from "../../util/text";

/** Enough for any real appointment mail; a newsletter-length automated mail is cut. */
const MAIL_CHARS = 6000;

export interface Mail {
  shortId: string;
  /** Every extraction of this mail on this run: Phase 2 can leave several, and any may be cited. */
  extractionIds: string[];
  sourceType: string;
  receivedAt: string | null;
  text: string;
  classification: Record<string, unknown>;
}

/**
 * The mails the agent may act on. Grouped by raw item, because a re-run of Phase 2 leaves one
 * extraction row per attempt (`docs/todo/now.md`) and the report may cite any of them.
 */
export async function candidateMails(runDate: string): Promise<Mail[]> {
  const rows = await db
    .select({
      extractionId: extractions.id,
      rawItemId: rawItems.id,
      sourceType: rawItems.sourceType,
      receivedAt: rawItems.receivedAt,
      rawContent: rawItems.rawContent,
      json: extractions.extractedJson,
      gatePassed: extractions.gatePassed,
      gateReason: extractions.gateReason,
    })
    .from(extractions)
    .innerJoin(rawItems, eq(rawItems.id, extractions.rawItemId))
    .where(and(eq(extractions.runDate, runDate), inArray(rawItems.sourceType, ["personal_email", "sms"])));

  const byMail = new Map<string, Mail>();
  for (const row of rows) {
    const json = (row.json ?? {}) as Record<string, unknown>;
    const flagged = json.calendar_event_suggested === true || json.todo_suggested === true;
    if (!row.gatePassed && !(row.gateReason === "automated_low_urgency" && flagged)) continue;

    const existing = byMail.get(row.rawItemId);
    if (existing) {
      existing.extractionIds.push(row.extractionId);
      continue;
    }
    byMail.set(row.rawItemId, {
      shortId: `m${byMail.size + 1}`,
      extractionIds: [row.extractionId],
      sourceType: row.sourceType,
      receivedAt: row.receivedAt,
      text: stripControlChars(row.rawContent ?? "").slice(0, MAIL_CHARS),
      classification: {
        type: json.type ?? null,
        urgency: json.urgency ?? null,
        deadline: json.deadline ?? null,
        action_required: json.action_required ?? null,
      },
    });
  }
  return [...byMail.values()];
}

/** Every open task, not the 40 Phase 3 ranks for Section 2: "already on the list" needs the whole list. */
export async function openTodos(runDate: string): Promise<TodoItem[]> {
  const rows = await db
    .select({ rawContent: rawItems.rawContent })
    .from(rawItems)
    .where(and(eq(rawItems.runDate, runDate), eq(rawItems.sourceType, "todo")));
  return parseJsonRows<TodoItem>(rows);
}

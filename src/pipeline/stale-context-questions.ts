/**
 * Contacts whose file the graph itself now doubts.
 *
 * `contacts.relationship`/`contextNotes` are set once - by a `revise_context` correction or by an
 * answered item question (`teachContact`, `src/questions/store.ts`) - and never touched again
 * except when the reader supplies a new answer. `contacts.updated_at`, by contrast, is bumped on
 * every single mail from that sender (`incrementContactEmailCounts`, `phase6/contacts.ts`), so it
 * says nothing about whether the file's *content* is still current - a contact who writes weekly
 * always looks freshly updated. `firstSeen` is used instead, the same proxy `entity-questions.ts`
 * uses for the same reason: a contact captured more than `MIN_AGE_DAYS` ago is not one whose file
 * is still being filled in, so if it now conflicts with what a new mail says, that is worth asking
 * about rather than assuming the file will catch up on its own.
 *
 * The actual judgment - does this mail's content sit oddly against the stored relationship or
 * notes - is made once, for free, inside the existing personal-mail classification call
 * (`context_conflict`/`context_conflict_detail`, `PERSONAL_EMAIL_PROMPT`), not here. This module
 * only turns a flagged extraction, for a contact old and described enough to have something to
 * conflict with, into a candidate - the same split `entity-questions.ts` makes between a model
 * decision made elsewhere and a mechanical, no-quota read of its result.
 */
import { daysAgo } from "../util/time";
import { and, eq, or, isNull, sql as drizzleSql } from "drizzle-orm";
import { contacts, db, extractions, rawItems } from "../db";
import type { CandidateInput } from "../questions/reconcile";
import { askedExtractionIds } from "../questions/store";

const MIN_AGE_DAYS = 10;

export async function staleContextCandidates(runDate: string): Promise<CandidateInput[]> {
  const threshold = daysAgo(MIN_AGE_DAYS);

  const rows = await db
    .select({
      extractionId: extractions.id,
      extractedJson: extractions.extractedJson,
      identifier: rawItems.sourceName,
      contactName: contacts.name,
      relationship: contacts.relationship,
      contextNotes: contacts.contextNotes,
    })
    .from(extractions)
    .innerJoin(rawItems, eq(rawItems.id, extractions.rawItemId))
    .innerJoin(contacts, eq(contacts.identifier, rawItems.sourceName))
    .where(
      and(
        eq(extractions.runDate, runDate),
        // `contacts.identifier` is email-shaped (schema check constraint) - an sms sender never
        // joins here, so restricting to the source type that actually can is what the join means.
        eq(rawItems.sourceType, "personal_email"),
        or(isNull(extractions.unknownContext), eq(extractions.unknownContext, false)),
        drizzleSql`(${extractions.extractedJson} ->> 'context_conflict')::boolean IS TRUE`,
        drizzleSql`${contacts.firstSeen} IS NOT NULL AND ${contacts.firstSeen} <= ${threshold}`,
        or(
          drizzleSql`${contacts.relationship} IS NOT NULL AND ${contacts.relationship} != ''`,
          drizzleSql`${contacts.contextNotes} IS NOT NULL AND ${contacts.contextNotes} != ''`,
        ),
      ),
    );

  if (rows.length === 0) return [];

  const asked = await askedExtractionIds();
  return rows
    .filter((r) => r.identifier && !asked.has(r.extractionId))
    .map((r) => {
      const json = (r.extractedJson ?? {}) as Record<string, unknown>;
      const detail = typeof json.context_conflict_detail === "string" ? json.context_conflict_detail.trim() : "";
      const name = r.contactName ?? r.identifier!;
      const stored = r.relationship || r.contextNotes || "";
      return {
        kind: "item" as const,
        question: detail
          ? `${name}: ${detail} - does that change what I have on file (${stored})?`
          : `A message from ${name} doesn't quite match what I have on file for them (${stored}) - what's changed?`,
        source: { extraction_id: r.extractionId, from: r.identifier!, subject: null, source_type: "personal_email", run_date: runDate },
        detail: { stored_relationship: r.relationship, stored_notes: r.contextNotes, conflict: detail || null },
      };
    });
}

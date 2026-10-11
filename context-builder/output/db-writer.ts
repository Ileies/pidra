// The two seed writers (contacts, Keep rule notes) that phases/finalize.ts runs independently
// after synthesis. Both are idempotent upserts safe to re-run (--seed-only): they never overwrite
// locked/corrected contacts. Rules: docs/context-builder.md.
import { db, contacts } from "../../src/db";
import { sql as drizzleSql } from "drizzle-orm";
import { seedHarvestedNotes } from "../../src/notes/store";
import { stripControlChars } from "../../src/util/text";
import type { ContactProfile } from "../pipeline/batch-contacts";
import type { NoteExtraction } from "../pipeline/extract-note";

// A full build seeds thousands of contacts; row-by-row writes were slow enough that one
// transient blip aborted the phase, so writes go out in batches.
const BATCH_SIZE = 500;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// `contacts.identifier` is the natural key the whole briefing joins on, so it must be an
// address. Headers that failed to parse used to land here verbatim as the identifier.
const EMAIL_SHAPED = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

/**
 * Upserts high/medium-importance contacts by identifier (email). On conflict only name and priority
 * refresh, and never on a `locked` (user-corrected) row; corpus metrics are insert-only.
 */
export async function seedContacts(contactProfiles: ContactProfile[]): Promise<void> {
  const highOrMedium = contactProfiles.filter(
    (c) => c.importance !== "low" && EMAIL_SHAPED.test(c.email),
  );
  if (highOrMedium.length === 0) return;

  for (const batch of chunk(highOrMedium, BATCH_SIZE)) {
    await db
      .insert(contacts)
      .values(batch.map((profile) => ({
        identifier: profile.email,
        name: stripControlChars(profile.name),
        priority: profile.importance,
        firstSeen: profile.lastSeen,
        emailCount: profile.emailCount,
        categories: profile.categories,
        actionCount: profile.actionCount,
      })))
      .onConflictDoUpdate({
        target: contacts.identifier,
        set: {
          name: drizzleSql`excluded.name`,
          priority: drizzleSql`excluded.priority`,
          updatedAt: drizzleSql`now()`,
          // Corpus metrics are deliberately absent: insert-only, so a re-seed cannot clobber the
          // live pipeline's running email count.
        },
        // Rows corrected via `revise_context` are locked; a re-seed must never undo a correction.
        setWhere: drizzleSql`${contacts.locked} IS NOT TRUE`,
      });
  }
}

/** Keep rules become `personal` notes, keyed by Keep note id; `seedHarvestedNotes` owns the re-run rules. */
export async function seedRuleNotes(noteExtractions: NoteExtraction[]): Promise<void> {
  const rules = noteExtractions.filter((n) => n.type === "rule" && n.importance !== "low");
  if (rules.length === 0) return;

  const items = rules.map((rule) => ({
    key: `keep_rule_${rule.id}`,
    content: stripControlChars(`${rule.title || rule.summary}: ${rule.rawText}`),
  }));
  const { added, refreshed } = await seedHarvestedNotes(items);
  console.log(`[context-builder] Rule notes: ${added} added, ${refreshed} refreshed, ${items.length - added - refreshed} left as they are`);
}

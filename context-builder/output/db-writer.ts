// The three seed writers (contacts, entities, Keep rule notes) that phases/finalize.ts runs
// independently after synthesis. All are idempotent upserts safe to re-run (--seed-only): they never
// overwrite locked/corrected contacts or the daily pipeline's live entity counts. Rules: docs/context-builder.md.
import { utcDay } from "../../src/util/time";
import { db, contacts, entities, entityMentions } from "../../src/db";
import { sql as drizzleSql } from "drizzle-orm";
import { seedHarvestedNotes } from "../../src/notes/store";
import { stripControlChars } from "../../src/util/text";
import { normalizeEntityKey } from "../../src/util/entities";
import type { ContactProfile } from "../pipeline/batch-contacts";
import type { NoteExtraction } from "../pipeline/extract-note";
import type { EmailExtraction } from "../pipeline/extract-email";

// A full build seeds a couple of thousand entities; row-by-row writes were slow enough that one
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

// A real entity name is short. Anything longer is the model having returned a whole list, a
// sentence, or its own commentary in the field, and it is noise in the graph either way.
const MAX_ENTITY_NAME_LENGTH = 80;

// Two shapes the extraction model reliably emits as "entities" that never resolve to anything:
// bare numbers and calendar dates. They pass the length check, and every update run re-injects
// them. Deliberately narrow - judging entity-ness in general is the model's job, not a regex's.
// Also catches phone numbers, which the model likes to return as entities.
const PURE_NUMBER = /^[\d.,:\s%+-]+$/;
// Spelled out in full rather than as a prefix plus a wildcard: `mar[a-z]*` swallows Martin,
// Markus and Marriott, `jan[a-z]*` swallows Jannik, and `apr[a-z]*` swallows apricot.
const MONTHS =
  "jan|januar|january|feb|februar|february|mar|march|mär|märz|maerz|apr|april|may|mai|" +
  "jun|juni|june|jul|juli|july|aug|august|sep|sept|september|okt|oktober|oct|october|" +
  "nov|november|dez|dezember|dec|december";
// Every branch requires a number, so a bare month name is left alone.
const DATE_LIKE = new RegExp(
  "^(?:" +
    // 2026-09-10, 10.09.2026, 09/10
    "\\d{1,4}[./-]\\d{1,2}(?:[./-]\\d{1,4})?" +
    // 10. September 2026
    `|\\d{1,2}\\.?\\s*(?:${MONTHS})\\.?(?:\\s+\\d{2,4})?` +
    // September 10, 2026 / September 2026
    `|(?:${MONTHS})\\.?\\s*\\d{1,4}(?:,?\\s+\\d{2,4})?` +
  ")$",
  "i",
);

function isJunkEntityName(name: string): boolean {
  return PURE_NUMBER.test(name) || DATE_LIKE.test(name);
}

/**
 * Inserts entities mentioned in the extractions, with corpus mention counts and `context_builder`
 * provenance rows. Insert-only (onConflictDoNothing): existing entities keep the daily pipeline's counts.
 */
export async function seedEntities(extractions: EmailExtraction[], noteExtractions: NoteExtraction[]): Promise<void> {
  // Case-insensitive dedupe within the run (first spelling wins; the DB unique index on name is
  // case-sensitive). Corpus frequency is kept on purpose: phase 3 of the daily pipeline only
  // promotes an entity once `mention_count >= 3`. `refs` is the provenance behind that count,
  // one (source_kind, source_ref) per contributing item.
  const stats = new Map<string, { name: string; count: number; first: string | null; last: string | null; refs: Map<string, string | null> }>();

  const record = (raw: unknown, date: string | null, sourceRef: string) => {
    // Model output goes straight into Postgres: an entity name with NUL bytes (rejected by `text`) once failed a whole batch.
    const name = stripControlChars(String(raw)).trim();
    if (name.length <= 2 || name.length > MAX_ENTITY_NAME_LENGTH) return null;
    if (isJunkEntityName(name)) return null;
    const key = normalizeEntityKey(name);
    const entry = stats.get(key) ?? { name, count: 0, first: null, last: null, refs: new Map() };
    entry.count += 1;
    if (date) {
      if (!entry.first || date < entry.first) entry.first = date;
      if (!entry.last || date > entry.last) entry.last = date;
    }
    if (!entry.refs.has(sourceRef)) entry.refs.set(sourceRef, date);
    stats.set(key, entry);
    return key;
  };

  for (const item of extractions) {
    // One item mentioning the same name twice is one mention, not two.
    const seen = new Set<string>();
    const date = item.date ? item.date.slice(0, 10) : null;
    const sourceRef = `email:${item.messageId}`;
    for (const raw of item.entities) {
      const key = record(raw, date, sourceRef);
      if (key && seen.has(key)) stats.get(key)!.count -= 1;
      else if (key) seen.add(key);
    }
  }
  // Notes carry no date, so they contribute frequency but never move `last_mentioned`.
  for (const item of noteExtractions) {
    const seen = new Set<string>();
    const sourceRef = `keep:${item.id}`;
    for (const raw of item.entities) {
      const key = record(raw, null, sourceRef);
      if (key && seen.has(key)) stats.get(key)!.count -= 1;
      else if (key) seen.add(key);
    }
  }

  if (stats.size === 0) return;

  const today = utcDay();

  for (const batch of chunk([...stats.values()], BATCH_SIZE)) {
    // Only brand-new rows come back from RETURNING, so only they get mention provenance.
    const inserted = await db
      .insert(entities)
      .values(batch.map((entry) => ({
        name: entry.name,
        mentionCount: entry.count,
        // first_seen follows the corpus dates (today only as fallback) so it never postdates last_mentioned.
        firstSeen: entry.first ?? today,
        lastMentioned: entry.last,
        status: "active",
        importance: "normal",
      })))
      .onConflictDoNothing({ target: entities.name })
      .returning({ id: entities.id, name: entities.name });

    if (inserted.length === 0) continue;
    const idByKey = new Map(inserted.map((row) => [normalizeEntityKey(row.name), row.id]));

    const mentionRows: (typeof entityMentions.$inferInsert)[] = [];
    for (const entry of batch) {
      const id = idByKey.get(normalizeEntityKey(entry.name));
      if (!id) continue;
      for (const [sourceRef, date] of entry.refs) {
        mentionRows.push({ entityId: id, sourceKind: "context_builder", sourceRef, mentionDate: date });
      }
    }
    for (const mentionBatch of chunk(mentionRows, BATCH_SIZE)) {
      await db.insert(entityMentions).values(mentionBatch).onConflictDoNothing();
    }
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

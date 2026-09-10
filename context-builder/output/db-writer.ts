import { db, contacts, entities, standingContext } from "../../src/db";
import { sql as drizzleSql } from "drizzle-orm";
import { stripControlChars } from "../../src/util/text";
import type { ContactProfile } from "../pipeline/batch-contacts";
import type { NoteExtraction } from "../pipeline/extract-note";
import type { EmailExtraction } from "../pipeline/extract-email";

// A full build seeds a couple of thousand entities. One round-trip per row took long enough that
// a single transient blip aborted the whole phase mid-way (and, before the phase steps were
// isolated, silently skipped standing_context) - so writes go out in batches instead.
const BATCH_SIZE = 500;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// `contacts.identifier` is the natural key the whole briefing joins on, so it must be an
// address. Headers that failed to parse used to land here verbatim as the identifier.
const EMAIL_SHAPED = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

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
      })))
      .onConflictDoUpdate({
        target: contacts.identifier,
        set: {
          name: drizzleSql`excluded.name`,
          priority: drizzleSql`excluded.priority`,
          updatedAt: drizzleSql`now()`,
        },
        // A row the user corrected through `revise_context` is left exactly as it is: a re-seed
        // must never undo a correction. See CONTEXT_REVISION_PLAN.md.
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

export async function seedEntities(extractions: EmailExtraction[], noteExtractions: NoteExtraction[]): Promise<void> {
  // Case-insensitive dedupe within the run, keeping the first spelling seen. The DB's unique
  // index on name is case-sensitive, so without this "Acme"/"acme" would both be inserted.
  // The corpus frequency is kept: it is the whole point of pre-seeding, because phase 3 only
  // promotes an entity into the synthesis payload once `mention_count >= 3`.
  const stats = new Map<string, { name: string; count: number; first: string | null; last: string | null }>();

  const record = (raw: unknown, date: string | null) => {
    // Model output goes straight into Postgres here: one entity name arrived with NUL
    // separators, which `text` rejects and which failed the entire batch over one row.
    const name = stripControlChars(String(raw)).trim();
    if (name.length <= 2 || name.length > MAX_ENTITY_NAME_LENGTH) return null;
    if (isJunkEntityName(name)) return null;
    const key = name.toLowerCase();
    const entry = stats.get(key) ?? { name, count: 0, first: null, last: null };
    entry.count += 1;
    if (date) {
      if (!entry.first || date < entry.first) entry.first = date;
      if (!entry.last || date > entry.last) entry.last = date;
    }
    stats.set(key, entry);
    return key;
  };

  for (const item of extractions) {
    // One item mentioning the same name twice is one mention, not two.
    const seen = new Set<string>();
    const date = item.date ? item.date.slice(0, 10) : null;
    for (const raw of item.entities) {
      const key = record(raw, date);
      if (key && seen.has(key)) stats.get(key)!.count -= 1;
      else if (key) seen.add(key);
    }
  }
  // Notes carry no date, so they contribute frequency but never move `last_mentioned`.
  for (const item of noteExtractions) {
    const seen = new Set<string>();
    for (const raw of item.entities) {
      const key = record(raw, null);
      if (key && seen.has(key)) stats.get(key)!.count -= 1;
      else if (key) seen.add(key);
    }
  }

  if (stats.size === 0) return;

  const today = new Date().toISOString().split("T")[0];

  for (const batch of chunk([...stats.values()], BATCH_SIZE)) {
    await db
      .insert(entities)
      .values(batch.map((entry) => ({
        name: entry.name,
        mentionCount: entry.count,
        // `first_seen` tracks the corpus, not the run: leaving it at today while
        // `last_mentioned` sits in the past would be incoherent on its face.
        firstSeen: entry.first ?? today,
        lastMentioned: entry.last,
        status: "active",
        importance: "normal",
      })))
      // Existing rows belong to the daily pipeline, which owns the live count from here on.
      .onConflictDoNothing({ target: entities.name });
  }
}

export async function seedStandingContext(noteExtractions: NoteExtraction[]): Promise<void> {
  const rules = noteExtractions.filter((n) => n.type === "rule" && n.importance !== "low");
  if (rules.length === 0) return;

  // Keyed by note id so a re-run updates the same row instead of accumulating duplicates.
  for (const batch of chunk(rules, BATCH_SIZE)) {
    await db
      .insert(standingContext)
      .values(batch.map((rule) => ({
        key: `keep_rule_${rule.id}`,
        value: stripControlChars(`${rule.title || rule.summary}: ${rule.rawText}`),
        source: "context_builder",
      })))
      .onConflictDoUpdate({
        target: standingContext.key,
        set: {
          value: drizzleSql`excluded.value`,
          updatedAt: drizzleSql`now()`,
        },
      });
  }
}

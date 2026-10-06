// Phase 2: extraction. Turns today's `raw_items` (newsletter, personal_email, sms) into
// `extractions` rows via `extractJson` (stage one of the two-stage split, docs/architecture-rules.md).
// Called by `run.ts`; the rows are judged next by `gate.ts` in Phase 3. Idempotent per raw item, and
// aborts the run when more than half of the items fail.
import { squash } from "../util/text";
import { contacts, db, extractions, notes, rawItems, sourceQuality } from "../db";
import { resolveActivePrompts, type EffectivePrompt, type PromptSection } from "../ai/active-prompts";
import { extractJson } from "../ai/openai";
import { buildPersonalEmailPrompt, type ClassificationContext } from "../ai/prompts";
import { loadEmailAccounts } from "../config/email-accounts";
import { emailEffectiveRelevance } from "./email-category";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { setDetail } from "../util/trace";

const CONCURRENCY = 4;
/** Recent notes cost tokens on every personal/sms item in a run; cap rather than send the archive. */
const MAX_CLASSIFICATION_NOTES = 30;
const NOTE_CHARS = 400;
/** The whole directory goes out on every personal/sms item; cap each entry's notes, not just the count. */
const CONTACT_NOTE_CHARS = 300;

// The only source types `extractItem` has a branch for. Todos and calendar events are read
// straight out of `raw_items` by Phase 3, so they never need a model call, and a news desk
// delivery (`web_news`) arrives with its extraction rows already written by `src/news/store.ts`.
// Keep this in sync with the branches in `extractItem`: anything missing here is silently never
// extracted, anything extra pads the failure ratio below with guaranteed successes.
const EXTRACTABLE_SOURCE_TYPES = new Set(["newsletter", "personal_email", "sms"]);

interface NewsletterExtraction {
  source: string;
  date: string;
  items: {
    headline: string;
    topic_tags: string[];
    key_claim: string;
    /** "teaser" is held back by the gate (`teaser_only`); see the extraction prompt. */
    substance?: "fact" | "argument" | "teaser";
    entities: string[];
    relevance_score: number;
  }[];
  skip_reason: string | null;
  entities_graph: EntityExtraction;
}

interface EntityExtraction {
  entities: { name: string; aliases: string[]; type: string; domain: string }[];
}

const STRING = { type: "string" };
const strictObject = (properties: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});

// Strict, so a field can neither drift nor truncate into unparseable JSON. Mirrors `NewsletterExtraction`
// and the prompt's JSON shape: change all three together.
const NEWSLETTER_SCHEMA = {
  name: "newsletter_extraction",
  schema: strictObject({
    source: STRING,
    date: STRING,
    items: {
      type: "array",
      items: strictObject({
        headline: STRING,
        topic_tags: { type: "array", items: STRING },
        key_claim: STRING,
        substance: { type: "string", enum: ["fact", "argument", "teaser"] },
        entities: { type: "array", items: STRING },
        relevance_score: { type: "integer" },
      }),
    },
    skip_reason: { type: ["string", "null"] },
    entities_graph: strictObject({
      entities: {
        type: "array",
        items: strictObject({ name: STRING, aliases: { type: "array", items: STRING }, type: STRING, domain: STRING }),
      },
    }),
  }),
};

// The claims alone fit the 2000 default; the graph is on top, and a dense issue lists many entities.
const NEWSLETTER_MAX_OUTPUT = 3000;

interface PersonalEmailClassification {
  type: string;
  email_category: "personal_important" | "general_news" | "automated" | "spam";
  urgency: string;
  deadline: string | null;
  action_required: string | null;
  unknown_context: boolean;
  question_for_user: string | null;
  sender_known: boolean;
  context_conflict: boolean;
  context_conflict_detail: string | null;
  calendar_event_suggested: boolean;
  todo_suggested: boolean;
}

// Resolved once per run, not per item: the whole point is that every item in a run is extracted
// with the same prompt, and 300 items must not mean 900 lookups.
type ExtractionPrompts = Record<Extract<PromptSection, "extraction" | "entity_extraction" | "personal_classification">, EffectivePrompt>;
type ExtractionValues = typeof extractions.$inferInsert;

async function hasSuccessfulExtraction(rawItemId: string): Promise<boolean> {
  const rows = await db
    .select({ aiFailed: extractions.aiFailed })
    .from(extractions)
    .where(eq(extractions.rawItemId, rawItemId));
  return rows.some((row) => row.aiFailed !== true);
}

async function saveExtraction(item: typeof rawItems.$inferSelect, values: ExtractionValues[], succeeded: boolean): Promise<boolean> {
  return db.transaction(async (tx) => {
    // Serialise overlapping runs for this item. The second run keeps the first run's IDs,
    // which may already be referenced by a report, an action or feedback.
    await tx.execute(sql`SELECT id FROM raw_items WHERE id = ${item.id} FOR UPDATE`);
    const existing = await tx
      .select({ aiFailed: extractions.aiFailed })
      .from(extractions)
      .where(eq(extractions.rawItemId, item.id));
    if (existing.some((row) => row.aiFailed !== true)) return true;

    // A failed attempt is one placeholder. Replace it and the new result in one transaction,
    // so a retry cannot leave half of a newsletter's stories behind.
    if (existing.length > 0) {
      await tx.delete(extractions).where(eq(extractions.rawItemId, item.id));
    }
    await tx.insert(extractions).values(values);
    return succeeded;
  });
}

/** Loaded once per run, not per item - the same reasoning as `prompts` in `runPhase2`. */
async function loadClassificationContext(): Promise<ClassificationContext> {
  const [contactRows, noteRows] = await Promise.all([
    db
      .select({ identifier: contacts.identifier, name: contacts.name, relationship: contacts.relationship, contextNotes: contacts.contextNotes })
      .from(contacts)
      .where(isNull(contacts.removedAt)),
    db
      .select({ content: notes.content, createdAt: notes.createdAt })
      .from(notes)
      .where(and(isNull(notes.deletedAt), inArray(notes.scope, ["personal", "contact", "global"]))),
  ]);

  const recentNotes = [...noteRows]
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
    .slice(0, MAX_CLASSIFICATION_NOTES)
    .map((n) => squash(n.content, NOTE_CHARS));

  const knownContacts = contactRows.map((c) => ({
    ...c,
    contextNotes: c.contextNotes ? squash(c.contextNotes, CONTACT_NOTE_CHARS) : null,
  }));

  return { knownContacts, notes: recentNotes };
}

async function extractItem(
  item: typeof rawItems.$inferSelect,
  runDate: string,
  accountCustomInstructions: string | null,
  prompts: ExtractionPrompts,
  classificationContext: ClassificationContext,
): Promise<boolean> {
  if (await hasSuccessfulExtraction(item.id)) return true;

  let values: ExtractionValues[];
  let succeeded = true;
  try {
    if (item.sourceType === "newsletter") {
      // One call: the body is billed once, and the entity graph rides along as a top-level field.
      const { entities_graph: entityData, ...newsletterData } = await extractJson<NewsletterExtraction>(
        `${prompts.extraction.text}\n\n${prompts.entity_extraction.text}`,
        item.rawContent ?? "",
        { schema: NEWSLETTER_SCHEMA, maxOutputTokens: NEWSLETTER_MAX_OUTPUT },
      );

      values = newsletterData.items.map((extracted) => ({
        rawItemId: item.id,
        runDate,
        extractedJson: { ...extracted, entities_graph: entityData },
        relevanceScore: extracted.relevance_score,
        effectiveRelevance: extracted.relevance_score,
        novelty: "new",
        includedInReport: false,
        aiFailed: false,
      }));

      if (newsletterData.items.length === 0) {
        values = [{
          rawItemId: item.id,
          runDate,
          extractedJson: { skip_reason: newsletterData.skip_reason },
          relevanceScore: 0,
          effectiveRelevance: 0,
          novelty: "new",
          includedInReport: false,
          aiFailed: false,
        }];
      }
    } else if (item.sourceType === "personal_email" || item.sourceType === "sms") {
      const prompt = buildPersonalEmailPrompt(prompts.personal_classification.text, accountCustomInstructions, classificationContext);
      const classification = await extractJson<PersonalEmailClassification>(
        prompt,
        item.rawContent ?? ""
      );

      const effectiveRelevance = emailEffectiveRelevance(classification.email_category, classification.urgency);

      values = [{
        rawItemId: item.id,
        runDate,
        extractedJson: classification,
        relevanceScore: effectiveRelevance,
        effectiveRelevance,
        novelty: "new",
        unknownContext: classification.unknown_context,
        questionForUser: classification.question_for_user,
        includedInReport: false,
        aiFailed: false,
      }];
    } else {
      throw new Error(`Unsupported extraction source type: ${item.sourceType}`);
    }
  } catch (err) {
    console.error(`Extraction failed for item ${item.id}:`, err);
    succeeded = false;
    values = [{
      rawItemId: item.id,
      runDate,
      extractedJson: null,
      relevanceScore: null,
      effectiveRelevance: null,
      novelty: "new",
      aiFailed: true,
    }];
  }
  return saveExtraction(item, values, succeeded);
}

export async function runPhase2(runDate: string): Promise<void> {
  console.log(`[Phase 2] Starting extraction for ${runDate}`);

  const accounts = await loadEmailAccounts();
  const accountMap = new Map(accounts.map((a) => [a.user, a]));

  const prompts = await resolveActivePrompts();
  const classificationContext = await loadClassificationContext();

  const disabledRows = await db
    .select({ sourceName: sourceQuality.sourceName })
    .from(sourceQuality)
    .where(eq(sourceQuality.isActive, false));
  const disabledSources = new Set(disabledRows.map((r) => r.sourceName));

  const items = await db.select().from(rawItems).where(eq(rawItems.runDate, runDate));

  // Drop the types that need no model call before anything else. Previously they stayed in the
  // queue, returned true from `extractItem` without doing work, and inflated both the log line
  // and the denominator of the abort check at the end: 171 todos turned a total wipeout of
  // every newsletter and email into a 16% failure rate, well under the 50% threshold.
  const extractable = items.filter((item) => EXTRACTABLE_SOURCE_TYPES.has(item.sourceType));
  const activeItems = extractable.filter((item) => !item.sourceName || !disabledSources.has(item.sourceName));

  const passthrough = items.length - extractable.length;
  const skipped = extractable.length - activeItems.length;
  if (passthrough > 0) {
    console.log(`[Phase 2] ${passthrough} item(s) need no extraction (todo/calendar/news desk) - read directly by Phase 3`);
  }
  if (skipped > 0) console.log(`[Phase 2] Skipping ${skipped} items from disabled sources`);
  console.log(`[Phase 2] ${activeItems.length} items to extract`);

  const results: boolean[] = [];
  const queue = [...activeItems];
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length > 0) {
      const item = queue.shift()!;
      const account = item.accountId ? accountMap.get(item.accountId) : null;
      const customInstructions = account?.customInstructions ?? null;
      results.push(await extractItem(item, runDate, customInstructions, prompts, classificationContext));
    }
  });

  const settled = await Promise.allSettled(workers);
  const rejected = settled.find((result) => result.status === "rejected");
  if (rejected?.status === "rejected") throw rejected.reason;

  const failed = results.filter((ok) => !ok).length;
  if (results.length > 0 && failed / results.length > 0.5) {
    throw new Error(
      `[Phase 2] ${failed}/${results.length} items failed extraction (>50%) - aborting run instead of synthesizing from a near-empty context`
    );
  }

  setDetail({ items: activeItems.length, failed, concurrency: CONCURRENCY });
  console.log(`[Phase 2] Extraction complete (${failed}/${results.length} failed)`);
}

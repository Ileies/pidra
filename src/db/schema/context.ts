import { boolean, check, integer, pgTable, real, text, unique, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createdAt, dateStr, jsonb, pk, timestamptz, updatedAt } from "./columns";

export const entities = pgTable("entities", {
  id: pk(),
  // Unique: every entity write is an upsert keyed on the name, and `onConflictDoNothing()` silently duplicated rows without it.
  name: text("name").unique().notNull(),
  aliases: text("aliases").array(),
  type: text("type"), // person | org | tech | law | event | concept | place
  domain: text("domain"),
  summary: text("summary"),
  firstSeen: dateStr("first_seen"),
  lastMentioned: dateStr("last_mentioned"),
  // Cached count of `entity_mentions` rows; only increment alongside a real insert there (pipeline/phase6/entities.ts).
  mentionCount: integer("mention_count").default(1),
  status: text("status").default("active"), // active | dormant | archived
  importance: text("importance").default("normal"), // high | normal | low
  // Set by a `revise_context` correction; re-seeds and bulk writers must leave the corrected fields alone.
  locked: boolean("locked").default(false),
  // Rotation cursor for the watch search slot (`src/search/slots.ts`): oldest (or null) is searched next.
  lastWatchSearch: dateStr("last_watch_search"),
});

/**
 * One entity mentioned once in one source item. The unique key makes a retry or same-date rerun a
 * no-op. `source_ref` points back at the source, never copies it: `raw_items.id` for a newsletter,
 * `"<email|keep>:<item_id>"` for a harvested one.
 */
export const entityMentions = pgTable("entity_mentions", {
  id: pk(),
  entityId: uuid("entity_id").notNull().references(() => entities.id, { onDelete: "cascade" }),
  sourceKind: text("source_kind").notNull(), // newsletter | context_builder
  sourceRef: text("source_ref").notNull(),
  mentionDate: dateStr("mention_date"),
  createdAt: createdAt(),
}, (t) => [unique("entity_mentions_entity_source").on(t.entityId, t.sourceKind, t.sourceRef)]);

export const entityAppearances = pgTable("entity_appearances", {
  id: pk(),
  entityId: uuid("entity_id").references(() => entities.id, { onDelete: "cascade" }),
  reportDate: dateStr("report_date"),
  contextSnippet: text("context_snippet"),
  relevanceScore: integer("relevance_score"),
}, (t) => [unique("entity_appearances_entity_date").on(t.entityId, t.reportDate)]);

export const sourceQuality = pgTable("source_quality", {
  sourceName: text("source_name").primaryKey(),
  trustScore: real("trust_score").default(1.0),
  includeRate30d: real("include_rate_30d"),
  avgRevealedRelevance: real("avg_revealed_relevance"),
  qualityTrend: text("quality_trend").default("stable"), // improving | stable | declining
  lastQualityShift: dateStr("last_quality_shift"),
  promotionalRate30d: real("promotional_rate_30d"),
  compositeScore30d: real("composite_score_30d"), // 0-10 rolling 30-day average
  isActive: boolean("is_active").default(true),
  disabledAt: dateStr("disabled_at"),
  disabledReason: text("disabled_reason"),
  notes: text("notes"),
  // Filled by IMAP ingest the first time a source is seen and never re-checked once `unsubscribeCheckedAt` is set.
  unsubscribeUrl: text("unsubscribe_url"),
  unsubscribeCheckedAt: timestamptz("unsubscribe_checked_at"),
  updatedAt: updatedAt(),
});

export const sourceDailyScores = pgTable("source_daily_scores", {
  id: pk(),
  sourceName: text("source_name").notNull(),
  runDate: dateStr("run_date").notNull(),
  itemsReceived: integer("items_received").default(0),
  itemsIncluded: integer("items_included").default(0), // proxy: effectiveRelevance >= 3
  avgRelevance: real("avg_relevance"),
  avgEffectiveRelevance: real("avg_effective_relevance"),
  includeRate: real("include_rate"), // 0-1
  compositeScore: real("composite_score"), // 0-10
  createdAt: createdAt(),
}, (t) => [unique("source_daily_scores_source_date").on(t.sourceName, t.runDate)]);

export const contacts = pgTable("contacts", {
  id: pk(),
  identifier: text("identifier").unique().notNull(),
  name: text("name"),
  relationship: text("relationship"),
  priority: text("priority").default("normal"), // critical | high | normal | low
  contextNotes: text("context_notes"),
  firstSeen: dateStr("first_seen").default(sql`CURRENT_DATE`),
  updatedAt: updatedAt(),
  // Set by a `revise_context` correction; `seedContacts` skips locked rows on re-seed.
  locked: boolean("locked").default(false),
  // Set by `remove_context_item`. The row stays (locked) and every reader skips it; reverting clears this.
  removedAt: timestamptz("removed_at"),
  // Seeded once from the Context Builder's corpus; re-seeding never overwrites these. The pipeline increments emailCount.
  emailCount: integer("email_count").default(0),
  categories: text("categories").array().default(sql`'{}'::text[]`),
  actionCount: integer("action_count").default(0),
}, (t) => [
  // `contacts` is an email sender directory (CLAUDE.md), so an address-less row must be impossible at the DB level too.
  check("contacts_identifier_email_like", sql`${t.identifier} LIKE '%@%.%'`),
]);

export const contextBuilderRuns = pgTable("context_builder_runs", {
  id: pk(),
  mode: text("mode").notNull(), // full | update | resume
  status: text("status").notNull().default("running"), // running | completed | failed | interrupted
  startedAt: timestamptz("started_at").default(sql`now()`),
  completedAt: timestamptz("completed_at"),
  itemsIndexed: integer("items_indexed").default(0),
  itemsSkipped: integer("items_skipped").default(0),
  sonnetTokensIn: integer("sonnet_tokens_in").default(0),
  sonnetTokensOut: integer("sonnet_tokens_out").default(0),
  // Legacy pointer at the archival JSON file; only the read fallback for rows written before `document` existed.
  outputPath: text("output_path"),
  // The harvest itself, stored where every reader can reach it. Same shape as the JSON file `writeOutputFiles` writes.
  document: jsonb("document").$type<{
    generatedAt: string;
    date: string;
    contacts: string;
    tasks: string;
    keep: string;
    github: string;
    fullContext: string;
  }>(),
  errorLog: jsonb("error_log").$type<{ source: string; error: string; ts: string }[]>(),
});

export const contextBuilderIndexedItems = pgTable("context_builder_indexed_items", {
  id: pk(),
  runId: uuid("run_id").references(() => contextBuilderRuns.id),
  source: text("source").notNull(), // email | keep | tasks | github
  itemId: text("item_id").notNull(), // message-id, note id, task id, repo name
  data: jsonb("data"), // the extraction result for this item - lets a resumed run reuse it instead of re-extracting
  indexedAt: timestamptz("indexed_at").default(sql`now()`),
}, (t) => [unique("cb_indexed_source_item").on(t.source, t.itemId)]);

/** The append-only correction layer over the harvested context: rows are never deleted or edited except to flip `status`. Only `src/context/corrections.ts` writes it. */
export const contextCorrections = pgTable("context_corrections", {
  id: pk(),
  targetKind: text("target_kind").notNull(), // document | entity | contact (standing_context on rows from before 0038)
  // Document heading, entity name, or contact identifier.
  targetKey: text("target_key").notNull(),
  operation: text("operation").notNull(), // amend | complement | retract
  /** The correct fact in the user's voice, injected verbatim into the daily synthesis payload. */
  statement: text("statement").notNull(),
  /** The wrong text being corrected, quoted from the harvest. */
  supersedesText: text("supersedes_text"),
  rationale: text("rationale"),
  /** Pre-merge snapshot of a structured row, so a revert restores exactly what was there. */
  previousState: jsonb("previous_state").$type<Record<string, unknown>>(),
  source: text("source").notNull().default("chat"), // chat | user | system
  status: text("status").notNull().default("active"), // active | reverted
  conversationId: uuid("conversation_id"),
  createdAt: createdAt(),
  revertedAt: timestamptz("reverted_at"),
});

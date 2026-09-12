import {
  pgTable,
  uuid,
  text,
  date,
  timestamp,
  boolean,
  integer,
  real,
  unique,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
// Not `jsonb` from pg-core: that one double-encodes on the Bun SQL driver. Same signature, so
// every column below is unchanged. See src/db/jsonb.ts.
import { jsonb } from "./jsonb";

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "string" });
const dateStr = (name: string) => date(name, { mode: "string" });

export const rawItems = pgTable("raw_items", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  runDate: dateStr("run_date").notNull(),
  sourceType: text("source_type").notNull(), // newsletter | personal_email | sms | calendar | todo
  sourceName: text("source_name"),
  accountId: text("account_id"), // which email account this came from (e.g. "news", "uni", "work", "private")
  messageId: text("message_id").unique(),
  rawContent: text("raw_content"),
  receivedAt: timestamptz("received_at"),
  createdAt: timestamptz("created_at").default(sql`now()`),
});

export const extractions = pgTable("extractions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  rawItemId: uuid("raw_item_id").references(() => rawItems.id),
  runDate: dateStr("run_date").notNull(),
  extractedJson: jsonb("extracted_json"),
  relevanceScore: integer("relevance_score"), // 1–5
  effectiveRelevance: real("effective_relevance"),
  novelty: text("novelty"), // new | continuation | repeat
  unknownContext: boolean("unknown_context").default(false),
  questionForUser: text("question_for_user"),
  includedInReport: boolean("included_in_report").default(false),
  revealedRelevance: integer("revealed_relevance"),
  aiFailed: boolean("ai_failed").default(false),
  createdAt: timestamptz("created_at").default(sql`now()`),
});

export const activeTopics = pgTable("active_topics", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  headline: text("headline").notNull(),
  domain: text("domain").notNull(), // AI | China | Finance | Geopolitics | Science | etc.
  runningSummary: text("running_summary"),
  firstSeen: dateStr("first_seen").notNull(),
  lastUpdated: dateStr("last_updated").notNull(),
  status: text("status").default("active"), // active | dormant | resolved
  updateCount: integer("update_count").default(1),
  sources: text("sources").array(),
  entityIds: uuid("entity_ids").array(),
});

export const dailyReports = pgTable("daily_reports", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  reportDate: dateStr("report_date").unique().notNull(),
  fullReport: text("full_report"),
  // The structured form of `fullReport`, parsed deterministically by pipeline/report-json.ts.
  // Nullable on purpose: a parse that cannot find both section headings writes null and the
  // dashboard falls back to rendering the markdown. `fullReport` stays the source of truth -
  // it is what the model actually produced, and the archive must stay readable if this parser
  // is ever wrong.
  reportJson: jsonb("report_json").$type<import("../pipeline/report-json").ReportJson | null>(),
  shortSummary: text("short_summary"),
  itemCount: integer("item_count"),
  itemsIncluded: integer("items_included"),
  itemsFiltered: integer("items_filtered"),
  tokensIn: integer("tokens_in"),
  tokensOut: integer("tokens_out"),
  aiCalls: integer("ai_calls"),
  webSearchesRun: integer("web_searches_run"),
  questionGateFired: boolean("question_gate_fired").default(false),
  createdAt: timestamptz("created_at").default(sql`now()`),
});

export const entities = pgTable("entities", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  // Unique: every entity write in the codebase is an upsert keyed on the name, and the
  // `onConflictDoNothing()` calls in phase6-memory silently duplicated rows without it.
  name: text("name").unique().notNull(),
  aliases: text("aliases").array(),
  type: text("type"), // person | org | tech | law | event | concept | place
  domain: text("domain"),
  summary: text("summary"),
  firstSeen: dateStr("first_seen"),
  lastMentioned: dateStr("last_mentioned"),
  mentionCount: integer("mention_count").default(1),
  status: text("status").default("active"), // active | dormant
  importance: text("importance").default("normal"), // high | normal | low
  // Set by a `revise_context` correction. Re-seeds and bulk writers must leave the corrected
  // fields alone; see CONTEXT_REVISION_PLAN.md.
  locked: boolean("locked").default(false),
});

export const entityRelations = pgTable("entity_relations", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  fromId: uuid("from_id").references(() => entities.id),
  toId: uuid("to_id").references(() => entities.id),
  relationType: text("relation_type"), // competes_with | heads | regulates | partners_with | acquired | enables | threatens | funds
  confidence: real("confidence"),
  firstSeen: dateStr("first_seen"),
  lastSeen: dateStr("last_seen"),
  confirmed: boolean("confirmed").default(false),
}, (t) => [unique("entity_relations_from_to_type").on(t.fromId, t.toId, t.relationType)]);

export const entityAppearances = pgTable("entity_appearances", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  entityId: uuid("entity_id").references(() => entities.id),
  reportDate: dateStr("report_date"),
  contextSnippet: text("context_snippet"),
  relevanceScore: integer("relevance_score"),
});

export const sourceQuality = pgTable("source_quality", {
  sourceName: text("source_name").primaryKey(),
  trustScore: real("trust_score").default(1.0),
  includeRate30d: real("include_rate_30d"),
  avgRevealedRelevance: real("avg_revealed_relevance"),
  qualityTrend: text("quality_trend").default("stable"), // improving | stable | declining
  lastQualityShift: dateStr("last_quality_shift"),
  promotionalRate30d: real("promotional_rate_30d"),
  compositeScore30d: real("composite_score_30d"), // 0–10 rolling 30-day average
  isActive: boolean("is_active").default(true),
  disabledAt: dateStr("disabled_at"),
  disabledReason: text("disabled_reason"),
  notes: text("notes"),
  updatedAt: timestamptz("updated_at").default(sql`now()`),
});

export const sourceDailyScores = pgTable("source_daily_scores", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  sourceName: text("source_name").notNull(),
  runDate: dateStr("run_date").notNull(),
  itemsReceived: integer("items_received").default(0),
  itemsIncluded: integer("items_included").default(0), // proxy: effectiveRelevance >= 3
  avgRelevance: real("avg_relevance"),
  avgEffectiveRelevance: real("avg_effective_relevance"),
  includeRate: real("include_rate"), // 0–1
  compositeScore: real("composite_score"), // 0–10
  createdAt: timestamptz("created_at").default(sql`now()`),
}, (t) => [unique("source_daily_scores_source_date").on(t.sourceName, t.runDate)]);

export const contacts = pgTable("contacts", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  identifier: text("identifier").unique().notNull(),
  name: text("name"),
  relationship: text("relationship"),
  priority: text("priority").default("normal"), // critical | high | normal | low
  contextNotes: text("context_notes"),
  firstSeen: dateStr("first_seen").default(sql`CURRENT_DATE`),
  updatedAt: timestamptz("updated_at").default(sql`now()`),
  // Set by a `revise_context` correction; `seedContacts` skips locked rows on re-seed.
  locked: boolean("locked").default(false),
  // Seeded once from the Context Builder's corpus count, then owned by the live pipeline going
  // forward - the same split as `entities.mention_count`. `seedContacts` only sets it on insert.
  emailCount: integer("email_count").default(0),
});

/**
 * The mutable working layer: the user's standing instructions plus whatever Phase 6 writes from
 * the `<!--SYSTEM-->` block. Unlike the harvested context, notes are edited in place - the
 * pre-change state is appended to `noteRevisions` and deletes are soft, so every mutation stays
 * reversible. `src/notes/store.ts` is the only writer. See ASSISTANT_PLAN.md.
 */
export const notes = pgTable("notes", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  content: text("content").notNull(),
  scope: text("scope").notNull(), // global | intel | personal | contact | search
  createdAt: timestamptz("created_at").default(sql`now()`),
  expiresAt: dateStr("expires_at"),
  createdBy: text("created_by").default("system"), // system | user
  updatedAt: timestamptz("updated_at"),
  updatedBy: text("updated_by"), // user | chat | system - never rewrites createdBy
  /** Soft delete. Every consumer must filter `deleted_at IS NULL`. */
  deletedAt: timestamptz("deleted_at"),
});

/**
 * Append-only history for `notes`, holding the state *before* each change - the same shape of
 * safety net as `previous_state` on the correction path. One row per mutation is enough for both
 * a per-revision revert and a full history panel.
 */
export const noteRevisions = pgTable("note_revisions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  noteId: uuid("note_id").notNull().references(() => notes.id, { onDelete: "cascade" }),
  operation: text("operation").notNull(), // update | delete | restore
  previousContent: text("previous_content"),
  previousScope: text("previous_scope"),
  previousExpiresAt: dateStr("previous_expires_at"),
  changedBy: text("changed_by").notNull(), // user | chat | system
  // Declared lazily: both tables are defined further down this module.
  skillExecutionId: uuid("skill_execution_id").references(() => skillExecutions.id, { onDelete: "set null" }),
  conversationId: uuid("conversation_id").references(() => chatConversations.id, { onDelete: "set null" }),
  createdAt: timestamptz("created_at").default(sql`now()`),
});

export const promptVersions = pgTable("prompt_versions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  version: integer("version").notNull(),
  section: text("section").notNull(), // section1 | section2 | extraction | entity_extraction | personal_classification
  promptText: text("prompt_text").notNull(),
  active: boolean("active").default(false),
  changeSummary: text("change_summary"),
  approvedAt: timestamptz("approved_at"),
  createdAt: timestamptz("created_at").default(sql`now()`),
});

export const feedbackEvents = pgTable("feedback_events", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  extractionId: uuid("extraction_id").references(() => extractions.id),
  eventType: text("event_type"), // downstream_action | explicit_plus | explicit_minus | weekly_review
  signalValue: integer("signal_value"),
  createdAt: timestamptz("created_at").default(sql`now()`),
});

/**
 * Dashboard-editable override layer over the code-defined skill registry, the same pattern as
 * `promptVersions` over the prompt baseline: the TypeScript module in `/skills/` stays the source
 * of truth, this table only adjusts what's shown/allowed on top of it. No row means "use the
 * code defaults" - `enabled` on insert already defaults to true, so a missing row and a present-
 * but-untouched row behave identically.
 */
export const skillOverrides = pgTable("skill_overrides", {
  skillName: text("skill_name").primaryKey(),
  enabled: boolean("enabled").notNull().default(true),
  riskLevelOverride: text("risk_level_override"), // low | medium | high | critical | null (use code default)
  descriptionOverride: text("description_override"),
  parameterDescriptionOverrides: jsonb("parameter_description_overrides").$type<Record<string, string>>(),
  updatedAt: timestamptz("updated_at").default(sql`now()`),
});

export const skillExecutions = pgTable("skill_executions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  runDate: dateStr("run_date"),
  skillName: text("skill_name"),
  parameters: jsonb("parameters"),
  status: text("status"), // pending | approved | executed | rejected | failed
  result: text("result"),
  triggeredBy: text("triggered_by"), // report_section | question_gate | manual
  createdAt: timestamptz("created_at").default(sql`now()`),
});

export interface GateQuestion {
  id: string;
  item_type: string; // email | sms
  from: string;
  subject?: string;
  question: string;
}

export interface GateAnswer {
  id: string;
  answer: string;
}

export const questionGateSessions = pgTable("question_gate_sessions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  runId: text("run_id").unique().notNull(),
  runDate: dateStr("run_date").notNull(),
  questions: jsonb("questions").notNull().$type<GateQuestion[]>(),
  answers: jsonb("answers").$type<GateAnswer[]>(),
  status: text("status").default("pending"), // pending | answered | timed_out
  timeoutAt: timestamptz("timeout_at").notNull(),
  createdAt: timestamptz("created_at").default(sql`now()`),
  answeredAt: timestamptz("answered_at"),
});

export interface StepAttemptError {
  step: string;
  attempt: number;
  error: string;
  stack?: string;
  ts: string;
}

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  endpoint: text("endpoint").unique().notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamptz("created_at").default(sql`now()`),
});

export const pipelineRuns = pgTable("pipeline_runs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  runDate: dateStr("run_date").notNull(),
  status: text("status").notNull().default("running"), // running | completed | failed
  failedStep: text("failed_step"),
  stepErrors: jsonb("step_errors").$type<StepAttemptError[]>(),
  startedAt: timestamptz("started_at").default(sql`now()`),
  completedAt: timestamptz("completed_at"),
  durationMs: integer("duration_ms"),
});

export const standingContext = pgTable("standing_context", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  key: text("key").unique().notNull(), // e.g. daily_life_rules | recurring_commitments | university
  value: text("value").notNull(),
  source: text("source").default("context_builder"), // context_builder | user | system
  updatedAt: timestamptz("updated_at").default(sql`now()`),
});

export const contextBuilderRuns = pgTable("context_builder_runs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  mode: text("mode").notNull(), // full | update | resume
  status: text("status").notNull().default("running"), // running | completed | failed | interrupted
  startedAt: timestamptz("started_at").default(sql`now()`),
  completedAt: timestamptz("completed_at"),
  itemsIndexed: integer("items_indexed").default(0),
  itemsSkipped: integer("items_skipped").default(0),
  sonnetTokensIn: integer("sonnet_tokens_in").default(0),
  sonnetTokensOut: integer("sonnet_tokens_out").default(0),
  outputPath: text("output_path"),
  errorLog: jsonb("error_log").$type<{ source: string; error: string; ts: string }[]>(),
});

/**
 * The correction layer over the harvested long-term context.
 *
 * Append-only by design: harvested information is never overwritten, only adjusted and
 * complemented. Rows are never deleted and never edited except to flip `status`, so the
 * history of what the harvest believed and what the user corrected stays intact. Full
 * reasoning in `CONTEXT_REVISION_PLAN.md`.
 */
export const contextCorrections = pgTable("context_corrections", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  targetKind: text("target_kind").notNull(), // document | standing_context | entity | contact
  // Document heading, standing_context key, entity name, or contact identifier.
  targetKey: text("target_key").notNull(),
  operation: text("operation").notNull(), // amend | complement | retract
  /** The correct fact in the user's voice. Injected verbatim into the daily synthesis payload. */
  statement: text("statement").notNull(),
  /** The wrong text being corrected, quoted from the harvest. Kept so the model can see both. */
  supersedesText: text("supersedes_text"),
  rationale: text("rationale"),
  /** Pre-merge snapshot of a structured row, so a revert restores exactly what was there. */
  previousState: jsonb("previous_state").$type<Record<string, unknown>>(),
  source: text("source").notNull().default("chat"), // chat | user | system
  status: text("status").notNull().default("active"), // active | reverted
  conversationId: uuid("conversation_id"),
  createdAt: timestamptz("created_at").default(sql`now()`),
  revertedAt: timestamptz("reverted_at"),
});

export const chatConversations = pgTable("chat_conversations", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title"),
  /** The surface the conversation started on - for grouping and labelling in /chat. */
  surface: text("surface"),
  origin: text("origin"), // widget | page
  createdAt: timestamptz("created_at").default(sql`now()`),
  updatedAt: timestamptz("updated_at").default(sql`now()`),
});

/** What the assistant was looking at when a turn was taken. Snapshotted per message, because a
 * conversation stays open while the user navigates between pages. */
export interface PageContextSnapshot {
  surface: string;
  route: string;
  digest?: string;
  focus?: { kind: string; id: string; label?: string }[];
}

export interface ChatToolCall {
  call_id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: string;
  status?: string;
}

export const chatMessages = pgTable("chat_messages", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: uuid("conversation_id").notNull().references(() => chatConversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // user | assistant
  content: text("content").notNull().default(""),
  /** Skill calls the assistant made on this turn, with their results, for replay and display. */
  toolCalls: jsonb("tool_calls").$type<ChatToolCall[]>(),
  /** The page the turn was taken on, as sent by the client and validated server-side. */
  pageContext: jsonb("page_context").$type<PageContextSnapshot>(),
  createdAt: timestamptz("created_at").default(sql`now()`),
});

export const contextBuilderIndexedItems = pgTable("context_builder_indexed_items", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  runId: uuid("run_id").references(() => contextBuilderRuns.id),
  source: text("source").notNull(), // email | keep | tasks | github
  itemId: text("item_id").notNull(), // message-id, note id, task id, repo name
  data: jsonb("data"), // the extraction result for this item - lets a resumed run reuse it instead of re-extracting
  indexedAt: timestamptz("indexed_at").default(sql`now()`),
}, (t) => [unique("cb_indexed_source_item").on(t.source, t.itemId)]);

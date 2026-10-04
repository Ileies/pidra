import { boolean, check, integer, pgTable, primaryKey, real, text, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { GateDetail } from "../../pipeline/gate";
import type { ReportJson } from "../../pipeline/report-json";
import type { ActionPreview } from "../../actions/propose";
import { bytea, createdAt, dateStr, jsonb, pk, timestamptz, updatedAt } from "./columns";
import { skillExecutions } from "./config";

export const rawItems = pgTable("raw_items", {
  id: pk(),
  runDate: dateStr("run_date").notNull(),
  sourceType: text("source_type").notNull(), // newsletter | personal_email | sms | calendar | todo | web_news
  sourceName: text("source_name"),
  accountId: text("account_id"), // which email account this came from (e.g. "news", "uni", "work", "private")
  messageId: text("message_id").unique(),
  rawContent: text("raw_content"),
  receivedAt: timestamptz("received_at"),
  createdAt: createdAt(),
});

/** The fields the pipeline reads off an extraction's JSON; the rest is whatever the extraction prompt (or a news desk) produced, read through a cast. */
export interface ExtractedJson {
  entities?: string[];
  headline?: string;
  key_claim?: string;
  topic_tags?: string[];
  /** Set instead of the claim fields when a newsletter was judged not worth extracting. */
  skip_reason?: string | null;
  /** Personal mail and SMS classification (`PersonalEmailClassification` in phase2-extract.ts). */
  type?: string;
  urgency?: string;
  deadline?: string | null;
  context_conflict?: boolean;
  calendar_event_suggested?: boolean;
  todo_suggested?: boolean;
}

export const extractions = pgTable("extractions", {
  id: pk(),
  rawItemId: uuid("raw_item_id").references(() => rawItems.id),
  runDate: dateStr("run_date").notNull(),
  extractedJson: jsonb("extracted_json").$type<ExtractedJson | null>(),
  relevanceScore: integer("relevance_score"), // 1-5
  effectiveRelevance: real("effective_relevance"),
  novelty: text("novelty"), // new | continuation | repeat
  unknownContext: boolean("unknown_context").default(false),
  questionForUser: text("question_for_user"),
  includedInReport: boolean("included_in_report").default(false),
  revealedRelevance: integer("revealed_relevance"),
  aiFailed: boolean("ai_failed").default(false),
  /** The Phase 3 gate verdict. Null means the run predates the column; /[date]/triage shows "not recorded", not a rejection. */
  gatePassed: boolean("gate_passed"),
  gateReason: text("gate_reason"), // see GateReason in pipeline/gate.ts
  /** The arithmetic behind the verdict: trust score, corroboration, threshold, category. */
  gateDetail: jsonb("gate_detail").$type<GateDetail | null>(),
  /** Section 1 newsletter handoff, separate from the Phase 3 gate verdict. */
  synthesisHandoff: text("synthesis_handoff"), // sent | outside_synthesis_capacity
  /** Stable, one-based order among gate-passed newsletter claims. */
  synthesisOrder: integer("synthesis_order"),
  createdAt: createdAt(),
});

/** Mails the IMAP ingest threw away before they became a `raw_items` row, so triage can say why one never arrived. Already-ingested mails are not logged. */
export const ingestDrops = pgTable("ingest_drops", {
  id: pk(),
  runDate: dateStr("run_date").notNull(),
  accountId: text("account_id"),
  sourceType: text("source_type"), // newsletter | personal_email
  sourceName: text("source_name"),
  messageId: text("message_id"),
  subject: text("subject"),
  sender: text("sender"),
  receivedAt: timestamptz("received_at"),
  // substack_system | ignored_sender | covered_by_rss | empty_content
  reason: text("reason").notNull(),
  createdAt: createdAt(),
});

export const activeTopics = pgTable("active_topics", {
  id: pk(),
  headline: text("headline").notNull(),
  domain: text("domain").notNull(), // AI | China | Finance | Geopolitics | Science | etc.
  runningSummary: text("running_summary"),
  firstSeen: dateStr("first_seen").notNull(),
  lastUpdated: dateStr("last_updated").notNull(),
  status: text("status").default("active"), // active | dormant | archived | resolved
  importance: text("importance").default("normal"), // high | normal | low
  updateCount: integer("update_count").default(1),
  sources: text("sources").array(),
  entityIds: uuid("entity_ids").array(),
});

export const dailyReports = pgTable("daily_reports", {
  id: pk(),
  reportDate: dateStr("report_date").unique().notNull(),
  /** The model's markdown, the source of truth: the archive stays readable if the parser behind `reportJson` is wrong. */
  fullReport: text("full_report"),
  /** Structured form of `fullReport` (pipeline/report-json.ts). Null when the parse found no section headings; the dashboard then renders the markdown. */
  reportJson: jsonb("report_json").$type<ReportJson | null>(),
  shortSummary: text("short_summary"),
  itemCount: integer("item_count"),
  itemsIncluded: integer("items_included"),
  itemsFiltered: integer("items_filtered"),
  tokensIn: integer("tokens_in"),
  tokensOut: integer("tokens_out"),
  aiCalls: integer("ai_calls"),
  webSearchesRun: integer("web_searches_run"),
  questionGateFired: boolean("question_gate_fired").default(false),
  createdAt: createdAt(),
});

/** One MP3 per spoken chapter. `chapterKey` hashes the spoken text, `variant` is `<model>:<voice>`. Only `src/audio/store.ts` writes it. */
export const reportAudio = pgTable("report_audio", {
  reportDate: dateStr("report_date").notNull(),
  chapterKey: text("chapter_key").notNull(),
  variant: text("variant").notNull(),
  audio: bytea("audio").notNull(),
  durationMs: integer("duration_ms").notNull(),
  chars: integer("chars").notNull(),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.reportDate, t.chapterKey, t.variant] })]);

/** Atomic, shared limit for every Brave API request, including retries and assistant searches. */
export const braveDailyUsage = pgTable("brave_daily_usage", {
  day: dateStr("day").primaryKey(),
  calls: integer("calls").notNull().default(0),
}, (t) => [check("brave_daily_usage_calls_range", sql`${t.calls} BETWEEN 0 AND 30`)]);

/** Quick actions: one-tap buttons beside a personal item, proposed by a separate model call in Phase 5. Only `src/actions/store.ts` writes it; a discarded proposal is kept with its reason. */
export const reportActions = pgTable("report_actions", {
  id: pk(),
  runDate: dateStr("run_date").notNull(),
  kind: text("kind").notNull(), // add_event | update_event | add_todo | complete_todo
  skillName: text("skill_name").notNull(),
  /** Exactly what the skill receives. */
  parameters: jsonb("parameters").notNull().$type<Record<string, unknown>>(),
  /** What the button shows. Display only. */
  preview: jsonb("preview").notNull().$type<ActionPreview>(),
  /** The model's one-line reason, shown beside an unattached action. */
  reason: text("reason"),
  /** The mails behind it; the dashboard attaches the button to the report entry citing them. */
  sourceExtractionIds: uuid("source_extraction_ids").array().notNull(),
  // proposed | running | done | failed | queued | dismissed | discarded
  status: text("status").notNull().default("proposed"),
  /** Why it was discarded, or what the skill said when it ran or failed. */
  statusDetail: text("status_detail"),
  skillExecutionId: uuid("skill_execution_id").references(() => skillExecutions.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const feedbackEvents = pgTable("feedback_events", {
  id: pk(),
  extractionId: uuid("extraction_id").references(() => extractions.id),
  eventType: text("event_type"), // downstream_action | explicit_plus | explicit_minus | weekly_review
  signalValue: integer("signal_value"),
  createdAt: createdAt(),
});

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: pk(),
  endpoint: text("endpoint").unique().notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: createdAt(),
});

export interface StepAttemptError {
  step: string;
  attempt: number;
  error: string;
  stack?: string;
  ts: string;
}

export const pipelineRuns = pgTable("pipeline_runs", {
  id: pk(),
  runDate: dateStr("run_date").notNull(),
  status: text("status").notNull().default("running"), // running | completed | failed
  failedStep: text("failed_step"),
  stepErrors: jsonb("step_errors").$type<StepAttemptError[]>(),
  startedAt: timestamptz("started_at").default(sql`now()`),
  completedAt: timestamptz("completed_at"),
  durationMs: integer("duration_ms"),
});

/** One row per measured stretch of a run (`src/util/trace.ts`). Spans nest through `parent_id`; counters are self values, the dashboard sums descendants. */
export const pipelineRunSteps = pgTable("pipeline_run_steps", {
  id: uuid("id").primaryKey(),
  runId: uuid("run_id").notNull().references(() => pipelineRuns.id, { onDelete: "cascade" }),
  parentId: uuid("parent_id"),
  step: text("step").notNull(),
  attempt: integer("attempt").notNull().default(1),
  status: text("status").notNull().default("running"), // running | ok | failed
  startedAt: timestamptz("started_at").notNull(),
  endedAt: timestamptz("ended_at"),
  durationMs: integer("duration_ms"),
  tokensIn: integer("tokens_in").notNull().default(0),
  tokensOut: integer("tokens_out").notNull().default(0),
  aiCalls: integer("ai_calls").notNull().default(0),
  searchCalls: integer("search_calls").notNull().default(0),
  flexRetries: integer("flex_retries").notNull().default(0),
  detail: jsonb("detail").$type<Record<string, unknown>>(),
});

/** Acknowledgements for dashboard notifications; the notifications themselves are projections of the source tables. */
export const notificationReads = pgTable("notification_reads", {
  notificationKey: text("notification_key").primaryKey(),
  readAt: timestamptz("read_at").default(sql`now()`),
});

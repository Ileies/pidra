import {
  pgTable,
  uuid,
  text,
  date,
  timestamp,
  boolean,
  integer,
  real,
  jsonb,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

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
  name: text("name").notNull(),
  aliases: text("aliases").array(),
  type: text("type"), // person | org | tech | law | event | concept | place
  domain: text("domain"),
  summary: text("summary"),
  firstSeen: dateStr("first_seen"),
  lastMentioned: dateStr("last_mentioned"),
  mentionCount: integer("mention_count").default(1),
  status: text("status").default("active"), // active | dormant
  importance: text("importance").default("normal"), // high | normal | low
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
});

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
  notes: text("notes"),
  updatedAt: timestamptz("updated_at").default(sql`now()`),
});

export const contacts = pgTable("contacts", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  identifier: text("identifier").unique().notNull(),
  name: text("name"),
  relationship: text("relationship"),
  priority: text("priority").default("normal"), // critical | high | normal | low
  contextNotes: text("context_notes"),
  firstSeen: dateStr("first_seen").default(sql`CURRENT_DATE`),
  updatedAt: timestamptz("updated_at").default(sql`now()`),
});

export const notes = pgTable("notes", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  content: text("content").notNull(),
  scope: text("scope").notNull(), // global | intel | personal | contact | search
  createdAt: timestamptz("created_at").default(sql`now()`),
  expiresAt: dateStr("expires_at"),
  createdBy: text("created_by").default("system"), // system | user
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

import { boolean, check, integer, pgTable, text, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createdAt, dateStr, jsonb, pk, timestamptz, updatedAt } from "./columns";

export const promptVersions = pgTable("prompt_versions", {
  id: pk(),
  version: integer("version").notNull(),
  section: text("section").notNull(), // one of PROMPT_SECTIONS in src/ai/active-prompts.ts
  promptText: text("prompt_text").notNull(),
  active: boolean("active").default(false),
  changeSummary: text("change_summary"),
  approvedAt: timestamptz("approved_at"),
  createdAt: createdAt(),
});

/** Skills are code-defined; this only tracks which ones the owner turned off on /skills. No row means enabled. */
export const disabledSkills = pgTable("disabled_skills", {
  skillName: text("skill_name").primaryKey(),
  disabledAt: timestamptz("disabled_at").default(sql`now()`),
});

/** The counterpart for skills that are off by default (`default_enabled: false`): a row means switched on. */
export const enabledSkills = pgTable("enabled_skills", {
  skillName: text("skill_name").primaryKey(),
  enabledAt: timestamptz("enabled_at").default(sql`now()`),
});

export const skillExecutions = pgTable("skill_executions", {
  id: pk(),
  runDate: dateStr("run_date"),
  skillName: text("skill_name"),
  parameters: jsonb("parameters"),
  status: text("status"), // pending | approved | executed | rejected | failed
  result: text("result"),
  triggeredBy: text("triggered_by"), // report_section | question_gate | manual
  createdAt: createdAt(),
});

/** The owner's preferences: one row, `id = 1`. A missing row means the defaults. Languages are two-letter codes, never free text. */
export const userSettings = pgTable("user_settings", {
  id: integer("id").primaryKey().default(1),
  uiLanguage: text("ui_language").notNull().default("en"),
  contentLanguage: text("content_language").notNull().default("en"),
  updatedAt: updatedAt(),
}, (t) => [
  check("user_settings_singleton", sql`${t.id} = 1`),
  check("user_settings_ui_language_code", sql`${t.uiLanguage} ~ '^[a-z]{2}$'`),
  check("user_settings_content_language_code", sql`${t.contentLanguage} ~ '^[a-z]{2}$'`),
]);

/** IMAP/SMTP accounts, edited on /settings/email-accounts. `password` is AES-256-GCM ciphertext (`src/config/crypto.ts`). */
export const emailAccounts = pgTable("email_accounts", {
  id: pk(),
  label: text("label").notNull(),
  host: text("host").notNull(),
  // Column name avoids the reserved word `user`; the TS field stays `user` to match `EmailAccount`.
  user: text("account_user").notNull(),
  password: text("password").notNull(),
  folder: text("folder").notNull().default("INBOX"),
  isNewsAccount: boolean("is_news_account").notNull().default(false),
  customInstructions: text("custom_instructions"),
  aliases: jsonb("aliases").$type<string[]>(),
  ignore: jsonb("ignore").$type<string[]>(),
  // Optional SMTP overrides - derived from host when omitted, see smtpHost() in email-accounts.ts.
  smtpHost: text("smtp_host"),
  smtpPort: integer("smtp_port"),
  smtpSecure: boolean("smtp_secure"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Live newsletter configuration edited from `/settings/newsletters`. */
export const newsletterSenderRules = pgTable("newsletter_sender_rules", {
  id: pk(),
  matchKind: text("match_kind").notNull(), // domain | address
  pattern: text("pattern").notNull(),
  sourceName: text("source_name").notNull(), // empty for generic Substack sender names
}, (t) => [unique("newsletter_sender_rules_match_unique").on(t.matchKind, t.pattern)]);

export const rssFeeds = pgTable("rss_feeds", {
  sourceName: text("source_name").primaryKey(),
  url: text("url").notNull(),
  lastError: text("last_error"),
  lastErrorAt: timestamptz("last_error_at"),
  lastSuccessAt: timestamptz("last_success_at"),
});

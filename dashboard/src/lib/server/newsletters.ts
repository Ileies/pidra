import { isIP } from "node:net";
import { sql } from "#lib/server/postgres.js";

export class NewsletterSettingsError extends Error {}

export interface FeedRow {
  sourceName: string;
  url: string;
  lastError: string | null;
  lastErrorAt: Date | null;
  lastSuccessAt: Date | null;
}

export interface SenderRuleRow {
  id: string;
  matchKind: "domain" | "address";
  pattern: string;
  sourceName: string;
}

function sourceName(value: string): string {
  const name = value.trim();
  if (!name || name.length > 120) throw new NewsletterSettingsError("Enter a source name (120 characters or fewer).");
  return name;
}

function feedUrl(value: string): string {
  let parsed: URL;
  try { parsed = new URL(value.trim()); }
  catch { throw new NewsletterSettingsError("Enter a valid HTTPS feed URL."); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password ||
      !parsed.hostname.includes(".") || isIP(parsed.hostname) ||
      /(^|\.)(localhost|local|internal)$/.test(parsed.hostname)) {
    throw new NewsletterSettingsError("Use a public HTTPS feed URL without credentials.");
  }
  return parsed.href;
}

function senderRule(kind: string, value: string, source: string) {
  if (kind !== "domain" && kind !== "address") throw new NewsletterSettingsError("Choose domain or exact address.");
  const pattern = value.trim().toLowerCase();
  const valid = kind === "address"
    ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pattern)
    : /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/.test(pattern);
  if (!valid || pattern.length > 255) throw new NewsletterSettingsError("Enter a valid sender domain or email address.");
  const name = source.trim();
  if (name.length > 120 || (kind === "address" && !name)) {
    throw new NewsletterSettingsError("An exact address needs a source name (120 characters or fewer).");
  }
  return { kind, pattern, name };
}

export async function listFeeds(): Promise<FeedRow[]> {
  return sql()<FeedRow[]>`SELECT source_name AS "sourceName", url, last_error AS "lastError",
    last_error_at AS "lastErrorAt", last_success_at AS "lastSuccessAt"
    FROM rss_feeds ORDER BY source_name`;
}

export async function listSenderRules(): Promise<SenderRuleRow[]> {
  return sql()<SenderRuleRow[]>`SELECT id::text, match_kind AS "matchKind", pattern,
    source_name AS "sourceName" FROM newsletter_sender_rules
    ORDER BY match_kind, pattern`;
}

export async function createFeed(name: string, url: string): Promise<void> {
  const db = sql();
  const rows = await db`INSERT INTO rss_feeds (source_name, url)
    VALUES (${sourceName(name)}, ${feedUrl(url)}) ON CONFLICT DO NOTHING RETURNING source_name`;
  if (!rows.length) throw new NewsletterSettingsError("That source already has an RSS feed.");
}

export async function updateFeed(oldName: string, name: string, url: string): Promise<void> {
  const db = sql();
  const rows = await db`UPDATE rss_feeds SET source_name = ${sourceName(name)}, url = ${feedUrl(url)},
    last_error = NULL, last_error_at = NULL, last_success_at = NULL
    WHERE source_name = ${oldName} RETURNING source_name`;
  if (!rows.length) throw new NewsletterSettingsError("Feed no longer exists. Reload the page.");
}

export async function deleteFeed(name: string): Promise<void> {
  await sql()`DELETE FROM rss_feeds WHERE source_name = ${name}`;
}

export async function createSenderRule(kind: string, pattern: string, name: string): Promise<void> {
  const rule = senderRule(kind, pattern, name);
  const rows = await sql()`INSERT INTO newsletter_sender_rules (match_kind, pattern, source_name)
    VALUES (${rule.kind}, ${rule.pattern}, ${rule.name}) ON CONFLICT DO NOTHING RETURNING id`;
  if (!rows.length) throw new NewsletterSettingsError("That sender rule already exists.");
}

export async function updateSenderRule(id: string, kind: string, pattern: string, name: string): Promise<void> {
  const rule = senderRule(kind, pattern, name);
  const rows = await sql()`UPDATE newsletter_sender_rules SET match_kind = ${rule.kind},
    pattern = ${rule.pattern}, source_name = ${rule.name} WHERE id = ${id} RETURNING id`;
  if (!rows.length) throw new NewsletterSettingsError("Sender rule no longer exists. Reload the page.");
}

export async function deleteSenderRule(id: string): Promise<void> {
  await sql()`DELETE FROM newsletter_sender_rules WHERE id = ${id}`;
}

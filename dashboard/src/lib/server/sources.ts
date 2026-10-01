import { sql } from "#lib/server/postgres.js";

/**
 * Hard delete: drops the source from `/sources` and from the config tables that make it get
 * polled or matched. History in `raw_items`/`extractions`/`source_daily_scores` is kept, same as
 * `deleteFeed`/`deleteSenderRule` on /settings/newsletters.
 */
export async function deleteSource(sourceName: string): Promise<void> {
  const db = sql();
  await db`DELETE FROM source_quality WHERE source_name = ${sourceName}`;
  await db`DELETE FROM rss_feeds WHERE source_name = ${sourceName}`;
  await db`DELETE FROM newsletter_sender_rules WHERE source_name = ${sourceName}`;
}

/** Disabled sources are excluded from extraction; the row is created if the source has none yet. */
export async function setSourceActive(sourceName: string, isActive: boolean, reason?: string): Promise<void> {
  const today = new Date().toISOString().split("T")[0];
  const disabledAt = isActive ? null : today;
  const disabledReason = isActive ? null : (reason ?? null);
  await sql()`
    INSERT INTO source_quality (source_name, is_active, disabled_at, disabled_reason)
    VALUES (${sourceName}, ${isActive}, ${disabledAt}::date, ${disabledReason})
    ON CONFLICT (source_name) DO UPDATE SET
      is_active = EXCLUDED.is_active,
      disabled_at = EXCLUDED.disabled_at,
      disabled_reason = EXCLUDED.disabled_reason
  `;
}

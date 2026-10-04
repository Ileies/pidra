import { utcDay } from "$pipeline/util/time";
import { sql } from "#lib/server/postgres.js";

/**
 * Hard delete of everything `/sources` knows about a source: its quality row, daily scores and
 * polling/matching config, in one transaction. Nothing remembers it afterwards, so a later mail
 * from the same sender starts a brand-new entry. Past reports and the data behind them
 * (`raw_items`, `extractions`, feedback, entity mentions) are pipeline history and stay.
 */
export async function deleteSource(sourceName: string): Promise<void> {
  await sql().begin(async (tx) => {
    await tx`DELETE FROM source_daily_scores WHERE source_name = ${sourceName}`;
    await tx`DELETE FROM source_quality WHERE source_name = ${sourceName}`;
    await tx`DELETE FROM rss_feeds WHERE source_name = ${sourceName}`;
    await tx`DELETE FROM newsletter_sender_rules WHERE source_name = ${sourceName}`;
  });
}

/** Disabled sources are excluded from extraction; the row is created if the source has none yet. */
export async function setSourceActive(sourceName: string, isActive: boolean, reason?: string): Promise<void> {
  const today = utcDay();
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

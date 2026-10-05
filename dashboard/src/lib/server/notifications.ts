import { sql } from "#lib/server/postgres.js";

// Keys of the `notification_reads` table (dashboard-only notifications, docs/architecture-rules.md).
export function reportNotificationKey(date: string): string {
  return `report:${date}`;
}

export function runNotificationKey(id: string): string {
  return `run:${id}`;
}

/** The one writer for notification acknowledgements. */
export async function acknowledgeNotification(key: string): Promise<void> {
  await sql()`
    INSERT INTO notification_reads (notification_key, read_at)
    VALUES (${key}, now())
    ON CONFLICT (notification_key) DO UPDATE SET read_at = EXCLUDED.read_at
  `;
}

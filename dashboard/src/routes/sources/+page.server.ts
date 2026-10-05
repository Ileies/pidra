import { readForm } from "#lib/server/form.js";
import type { Actions, PageServerLoad } from "./$types";
import { fail } from "@sveltejs/kit";
import { sql } from "#lib/server/postgres.js";
import { setSourceActive } from "#lib/server/sources.js";
import { recentDailyScores, type DailyScore } from "#lib/server/sourceScores.js";

// `/sources` data: `source_quality` rows (best 30-day score first) joined in memory with the last
// `raw_items` delivery and up to 30 daily scores. The `toggle` action (enable/disable) writes
// straight to Postgres via `$lib/server/sources.ts`, no pipeline server needed. Online-only.
export interface SourceRow {
  sourceName: string;
  isActive: boolean;
  disabledAt: string | null;
  disabledReason: string | null;
  trustScore: number | null;
  lastDelivery: string | Date | null;
  compositeScore30d: number | null;
  unsubscribeUrl: string | null;
  dailyScores: DailyScore[];
}

type QualityRow = Omit<SourceRow, "dailyScores" | "lastDelivery">;

export const load: PageServerLoad = async () => {
  const db = sql();
  const [qualityRows, dailyRows, deliveryRows] = await Promise.all([
    db<QualityRow[]>`
      SELECT source_name AS "sourceName", is_active AS "isActive",
             disabled_at::text AS "disabledAt", disabled_reason AS "disabledReason",
             trust_score AS "trustScore",
             composite_score_30d AS "compositeScore30d", unsubscribe_url AS "unsubscribeUrl"
      FROM source_quality
      ORDER BY composite_score_30d DESC NULLS LAST
    `,
    recentDailyScores(),
    db<{ sourceName: string; lastDelivery: string | Date | null }[]>`
      SELECT source_name AS "sourceName", max(received_at) AS "lastDelivery"
      FROM raw_items
      GROUP BY source_name
    `,
  ]);

  const lastDeliveryBySource = new Map<string, string | Date | null>();
  for (const row of deliveryRows) {
    lastDeliveryBySource.set(row.sourceName, row.lastDelivery);
  }

  const dailyBySource = new Map<string, DailyScore[]>();
  for (const row of dailyRows) {
    const scores = dailyBySource.get(row.sourceName) ?? [];
    scores.push(row);
    dailyBySource.set(row.sourceName, scores);
  }

  const sources: SourceRow[] = qualityRows.map((row) => ({
    ...row,
    lastDelivery: lastDeliveryBySource.get(row.sourceName) ?? null,
    dailyScores: (dailyBySource.get(row.sourceName) ?? []).slice(0, 30),
  }));
  return { sources };
};

export const actions: Actions = {
  toggle: async ({ request }) => {
    const form = await readForm(request);
    const sourceName = form.text("sourceName");
    const isActive = form.flag("isActive");
    const reason = (form.text("reason")) || undefined;

    if (!sourceName) return fail(400, { error: "sourceName required" });

    try {
      await setSourceActive(sourceName, isActive, reason);
    } catch (err) {
      console.error("source toggle failed", err);
      return fail(500, { error: "Could not update the source." });
    }
    return { ok: true };
  },
};

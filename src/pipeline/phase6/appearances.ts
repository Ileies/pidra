import { db, entities, entityAppearances, extractions } from "../../db";
import { eq, inArray, notInArray, and } from "drizzle-orm";
import { normalizeEntityKey } from "../../util/entities";

/**
 * Stage 4.1: the entity timeline is built only from entities named in report items the reader
 * actually got - `includedIds` are the extraction ids `resolveReportRefs` verified against real
 * citations, so a claim the gate passed but synthesis never cited cannot put an entry on a
 * timeline that is supposed to mean "this showed up in a report". A rerun for the same date
 * replaces the set instead of accumulating: an entity no longer cited (a rewrite dropped the
 * claim, or a dead citation got stripped) loses that day's entry rather than keeping a stale one.
 */
export async function writeEntityAppearances(runDate: string, includedIds: string[]): Promise<void> {
  const existingEntities = await db.select({ id: entities.id, name: entities.name, aliases: entities.aliases }).from(entities);
  const entityByKey = new Map<string, { id: string }>();
  for (const e of existingEntities) {
    entityByKey.set(normalizeEntityKey(e.name), e);
    for (const alias of e.aliases ?? []) {
      const key = normalizeEntityKey(alias);
      if (!entityByKey.has(key)) entityByKey.set(key, e);
    }
  }

  const rows = includedIds.length > 0
    ? await db.select({ extractedJson: extractions.extractedJson, relevanceScore: extractions.relevanceScore })
        .from(extractions)
        .where(inArray(extractions.id, includedIds))
    : [];

  const byEntity = new Map<string, { relevanceScore: number | null; snippet: string | null }>();
  for (const row of rows) {
    const json = row.extractedJson;
    // Personal/SMS extractions carry no `entities` field at all, so they fall out here on their
    // own; newsletter and news-desk extractions both carry one.
    const names = json?.entities ?? [];
    if (names.length === 0) continue;
    const snippetRaw = json?.key_claim ?? json?.headline ?? null;
    const snippet = snippetRaw ? String(snippetRaw).slice(0, 300) : null;
    for (const name of names) {
      const entity = entityByKey.get(normalizeEntityKey(name));
      // The first cited item mentioning this entity today wins its snippet - today's items are
      // already relevance-ordered for Section 1, so that is also usually the most relevant one.
      if (!entity || byEntity.has(entity.id)) continue;
      byEntity.set(entity.id, { relevanceScore: row.relevanceScore, snippet });
    }
  }

  const keep = [...byEntity.keys()];
  await db.delete(entityAppearances).where(
    keep.length > 0
      ? and(eq(entityAppearances.reportDate, runDate), notInArray(entityAppearances.entityId, keep))
      : eq(entityAppearances.reportDate, runDate),
  );

  for (const [entityId, data] of byEntity) {
    await db.insert(entityAppearances)
      .values({ entityId, reportDate: runDate, contextSnippet: data.snippet, relevanceScore: data.relevanceScore })
      .onConflictDoUpdate({
        target: [entityAppearances.entityId, entityAppearances.reportDate],
        set: { contextSnippet: data.snippet, relevanceScore: data.relevanceScore },
      });
  }

  if (byEntity.size > 0) {
    console.log(`[Phase 6] Wrote ${byEntity.size} entity appearance(s) for ${runDate}`);
  }
}

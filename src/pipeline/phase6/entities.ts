import { db, entities, entityMentions, extractions, rawItems } from "../../db";
import { eq, and, sql as drizzleSql } from "drizzle-orm";
import { normalizeEntityKey } from "../../util/entities";

interface EntityGraphEntity {
  name: string;
  aliases: string[];
  type: string;
  domain: string;
}

/**
 * One newsletter (`raw_item_id`) carries one entity graph, copied by Phase 2 onto every claim
 * extracted from it. Counting per extraction row - as this used to - counts the same mention once
 * per claim instead of once per newsletter; keying this map on `rawItemId` is what makes it once
 * per source item instead.
 */
export async function upsertEntitiesFromExtractions(runDate: string): Promise<void> {
  const rows = await db
    .select({ rawItemId: extractions.rawItemId, extractedJson: extractions.extractedJson })
    .from(extractions)
    .innerJoin(rawItems, eq(rawItems.id, extractions.rawItemId))
    .where(and(eq(extractions.runDate, runDate), eq(rawItems.sourceType, "newsletter")));

  const graphByRawItem = new Map<string, EntityGraphEntity[]>();
  for (const row of rows) {
    if (!row.rawItemId || graphByRawItem.has(row.rawItemId)) continue;
    const graph = (row.extractedJson as any)?.entities_graph;
    if (!graph?.entities?.length) continue;
    graphByRawItem.set(row.rawItemId, graph.entities as EntityGraphEntity[]);
  }

  if (graphByRawItem.size === 0) return;

  // Aggregate names across today's newsletters so one round trip resolves every entity, keeping
  // one mention record per (entity, raw_item) even when several graphs today name the same thing.
  const byKey = new Map<string, { name: string; aliases: Set<string>; type: string; domain: string; rawItemIds: Set<string> }>();
  for (const [rawItemId, graphEntities] of graphByRawItem) {
    for (const e of graphEntities) {
      if (!e.name) continue;
      const key = normalizeEntityKey(e.name);
      const hit = byKey.get(key);
      if (hit) {
        hit.rawItemIds.add(rawItemId);
        for (const alias of e.aliases ?? []) hit.aliases.add(alias);
      } else {
        byKey.set(key, { name: e.name, aliases: new Set(e.aliases ?? []), type: e.type ?? "concept", domain: e.domain ?? "", rawItemIds: new Set([rawItemId]) });
      }
    }
  }

  const existingEntities = await db.select({ id: entities.id, name: entities.name, aliases: entities.aliases }).from(entities);
  const existingByKey = new Map(existingEntities.map((e) => [normalizeEntityKey(e.name), e]));

  let mentionsWritten = 0;
  for (const [key, data] of byKey) {
    const aliases = [...data.aliases].filter((a) => normalizeEntityKey(a) !== key);
    const existing = existingByKey.get(key);

    await db.transaction(async (tx) => {
      let id: string;
      if (existing) {
        id = existing.id;
        const mergedAliases = [...new Set([...(existing.aliases ?? []), ...aliases])];
        // Never touches type/domain/summary/importance/status: those are the fields a
        // `revise_context` correction owns, and this writer runs unconditionally on every row.
        await tx.update(entities).set({ aliases: mergedAliases.length > 0 ? mergedAliases : null }).where(eq(entities.id, id));
      } else {
        const [inserted] = await tx.insert(entities)
          .values({ name: data.name, aliases: aliases.length > 0 ? aliases : null, type: data.type, domain: data.domain, firstSeen: runDate, mentionCount: 0, status: "active" })
          .returning({ id: entities.id });
        id = inserted.id;
      }

      // One row per (entity, newsletter). A rerun or a Phase 6 retry re-inserts the same
      // (entity_id, 'newsletter', raw_item_id) key and conflicts, so the count below only moves
      // on a mention that is actually new.
      const inserted = await tx.insert(entityMentions)
        .values([...data.rawItemIds].map((rawItemId) => ({ entityId: id, sourceKind: "newsletter", sourceRef: rawItemId, mentionDate: runDate })))
        .onConflictDoNothing()
        .returning({ id: entityMentions.id });

      if (inserted.length > 0) {
        await tx.update(entities)
          .set({ mentionCount: drizzleSql`${entities.mentionCount} + ${inserted.length}`, lastMentioned: runDate })
          .where(eq(entities.id, id));
        mentionsWritten += inserted.length;
      }
    });
  }

  console.log(`[Phase 6] Upserted ${byKey.size} entities, ${mentionsWritten} new mention(s) from ${graphByRawItem.size} newsletter(s)`);
}

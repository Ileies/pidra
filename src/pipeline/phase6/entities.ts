import { db, entities, entityRelations, extractions, rawItems } from "../../db";
import { eq, and } from "drizzle-orm";

export async function upsertEntitiesFromExtractions(runDate: string): Promise<void> {
  const rows = await db
    .select({ extractedJson: extractions.extractedJson })
    .from(extractions)
    .innerJoin(rawItems, eq(rawItems.id, extractions.rawItemId))
    .where(and(eq(extractions.runDate, runDate), eq(rawItems.sourceType, "newsletter")));

  // Aggregate entities across all newsletter extractions for today
  const entityMap = new Map<string, { name: string; aliases: Set<string>; type: string; domain: string; count: number }>();
  const relationList: { from: string; to: string; type: string; confidence: number }[] = [];

  for (const row of rows) {
    const json = row.extractedJson as any;
    const graph = json?.entities_graph;
    if (!graph) continue;

    for (const e of (graph.entities ?? []) as { name: string; aliases: string[]; type: string; domain: string }[]) {
      const key = e.name.toLowerCase();
      const hit = entityMap.get(key);
      if (hit) {
        hit.count++;
        for (const alias of e.aliases ?? []) hit.aliases.add(alias);
      } else {
        entityMap.set(key, { name: e.name, aliases: new Set(e.aliases ?? []), type: e.type ?? "concept", domain: e.domain ?? "", count: 1 });
      }
    }

    for (const r of (graph.relations ?? []) as { from: string; to: string; type: string; confidence: number }[]) {
      relationList.push(r);
    }
  }

  if (entityMap.size === 0) return;

  // Load existing entities to match by lowercase name
  const existingEntities = await db.select({ id: entities.id, name: entities.name, mentionCount: entities.mentionCount, aliases: entities.aliases }).from(entities);
  const existingByName = new Map(existingEntities.map((e) => [e.name.toLowerCase(), e]));

  // Upsert entities
  const nameToId = new Map<string, string>();
  for (const [key, data] of entityMap) {
    const aliases = [...data.aliases].filter((a) => a.toLowerCase() !== key);
    const existing = existingByName.get(key);

    if (existing) {
      const mergedAliases = [...new Set([...(existing.aliases ?? []), ...aliases])];
      await db.update(entities)
        .set({ mentionCount: (existing.mentionCount ?? 0) + data.count, lastMentioned: runDate, aliases: mergedAliases })
        .where(eq(entities.id, existing.id));
      nameToId.set(key, existing.id);
    } else {
      const [inserted] = await db.insert(entities)
        .values({ name: data.name, aliases: aliases.length > 0 ? aliases : null, type: data.type, domain: data.domain, firstSeen: runDate, lastMentioned: runDate, mentionCount: data.count, status: "active" })
        .returning({ id: entities.id });
      if (inserted) nameToId.set(key, inserted.id);
    }
  }

  // Upsert relations using resolved entity IDs
  for (const rel of relationList) {
    const fromId = nameToId.get(rel.from.toLowerCase());
    const toId = nameToId.get(rel.to.toLowerCase());
    if (!fromId || !toId || fromId === toId) continue;

    await db.insert(entityRelations)
      .values({ fromId, toId, relationType: rel.type, confidence: rel.confidence, firstSeen: runDate, lastSeen: runDate })
      .onConflictDoNothing();
  }

  console.log(`[Phase 6] Upserted ${entityMap.size} entities, ${relationList.length} relation(s) from synthesis output`);
}

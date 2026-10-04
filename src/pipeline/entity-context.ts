import type { entities } from "../db";
import { normalizeEntityKey } from "../util/entities";
import { SECTION1_CAPACITY } from "./section1-handoff";
import type { ExtractionWithSource } from "./gate-items";

/** How many entities Section 1 gets context for. The gate and SECTION1_CAPACITY already bound
 *  how many claims reach synthesis; this bounds the entity side of the same payload the same way. */
const ENTITY_CONTEXT_CAP = 15;

type Entity = typeof entities.$inferSelect;

/**
 * Relevant entity contexts (mention_count >= 3), for Section 1. Matched only against the claims
 * Section 1 actually receives - gate-passed newsletter items within SECTION1_CAPACITY - so a claim
 * the gate rejected cannot introduce entity context on its own; the News section is written from
 * its stories alone, so news entities are excluded the same way they always were. Matching is
 * canonical-name-or-alias, case-insensitive, and the result is capped and ranked by mention count
 * like everything else Section 1 receives a bounded slice of.
 */
export function matchEntityContexts(newsletterItems: ExtractionWithSource[], entityList: Entity[]): Entity[] {
  const mentionedKeys = new Set(
    newsletterItems
      .slice(0, SECTION1_CAPACITY)
      .flatMap((i) => i.extraction.extractedJson?.entities ?? [])
      .map(normalizeEntityKey),
  );

  const entityByKey = new Map<string, Entity>();
  for (const e of entityList) {
    entityByKey.set(normalizeEntityKey(e.name), e);
    for (const alias of e.aliases ?? []) {
      const aliasKey = normalizeEntityKey(alias);
      if (!entityByKey.has(aliasKey)) entityByKey.set(aliasKey, e);
    }
  }

  const matched = new Map<string, Entity>();
  for (const key of mentionedKeys) {
    const e = entityByKey.get(key);
    if (e && (e.mentionCount ?? 0) >= 3) matched.set(e.id, e);
  }
  return [...matched.values()]
    .sort((a, b) => (b.mentionCount ?? 0) - (a.mentionCount ?? 0))
    .slice(0, ENTITY_CONTEXT_CAP);
}

/**
 * Section 1's input limit is independent of the relevance gate: the first 30 gate-passed newsletter
 * items (by `orderNewsletterItems`) reach synthesis, the rest are marked `outside_synthesis_capacity`
 * in `extractions.synthesis_handoff` by `persistGate` (gate-items.ts).
 */
export const SECTION1_CAPACITY = 30;

/** Sort by the gate's effective score, then by a stable extraction ID for ties. */
export function orderNewsletterItems<T extends { extraction: { id: string; effectiveRelevance: number | null } }>(items: T[]): T[] {
  return [...items].sort((a, b) =>
    (b.extraction.effectiveRelevance ?? 0) - (a.extraction.effectiveRelevance ?? 0) ||
    (a.extraction.id < b.extraction.id ? -1 : a.extraction.id > b.extraction.id ? 1 : 0)
  );
}

/** `order` is the 1-based position from `orderNewsletterItems`; null (not a newsletter item) stays unmarked. */
export function handoffForOrder(order: number | null): "outside_synthesis_capacity" | null {
  return order !== null && order > SECTION1_CAPACITY ? "outside_synthesis_capacity" : null;
}

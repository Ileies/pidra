/**
 * Canonical-name normalization shared by every entity writer and reader (Phase 6, the Context
 * Builder seed, Phase 3's matching, the backfill script). Case-insensitive, whitespace-collapsed:
 * "Acme", " acme ", "ACME" must resolve to the same row and the same key in a mention map.
 */
export function normalizeEntityKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

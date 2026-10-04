/**
 * Stub for `$app/navigation`. `invalidate` records the dependency keys a predicate matched, so a
 * test can assert exactly which mirror stores a write or a sync re-ran loads for.
 */

import { MIRROR_STORES } from "../../src/lib/offline/db.js";

export const invalidated: string[][] = [];

export async function invalidate(match: (url: URL) => boolean): Promise<void> {
  const keys = [...MIRROR_STORES, "status"].map((name) => `mirror:${name}`);
  invalidated.push(keys.filter((key) => match(new URL(key))).sort());
}

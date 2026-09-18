/**
 * `standing_context` writes, in one place so the form actions on `/rules` and the JSON endpoints
 * the offline outbox posts to (OFFLINE_PLAN.md O3) cannot drift apart.
 *
 * Create is the one operation with two different jobs at once: a person typing a new key in the
 * UI wants to be told when it is already taken, but a queued offline create replaying against a
 * key that reached the server on an earlier, response-lost attempt must not error - it must land
 * on the same row. `createRuleChecked` is the interactive path (409 on a real collision);
 * `upsertRuleByKey` is what the outbox calls, and is genuinely idempotent: replaying it twice
 * writes the same value twice, which is a no-op.
 */

import { sql } from "#lib/db.js";

export class RuleError extends Error {}

export const KEY_RE = /^[a-z0-9_]{2,64}$/;

function normaliseKey(key: string): string {
  const value = (key ?? "").trim().toLowerCase();
  if (!KEY_RE.test(value)) throw new RuleError("A key is lowercase letters, digits and underscores, 2-64 characters.");
  return value;
}

function normaliseValue(value: string): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) throw new RuleError("A rule needs text.");
  return trimmed;
}

export async function createRuleChecked(rawKey: string, rawValue: string): Promise<{ id: string; key: string }> {
  const key = normaliseKey(rawKey);
  const value = normaliseValue(rawValue);

  const db = sql();
  const [existing] = await db`SELECT 1 FROM standing_context WHERE key = ${key}`;
  if (existing) throw new RuleError(`A rule with the key "${key}" already exists.`);

  const [row] = await db`INSERT INTO standing_context (key, value, source) VALUES (${key}, ${value}, 'user') RETURNING id`;
  return { id: row.id as string, key };
}

/** The outbox's create: same row every time a given key is replayed, never a 409. */
export async function upsertRuleByKey(rawKey: string, rawValue: string): Promise<{ id: string; key: string }> {
  const key = normaliseKey(rawKey);
  const value = normaliseValue(rawValue);

  const [row] = await sql()`
    INSERT INTO standing_context (key, value, source) VALUES (${key}, ${value}, 'user')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, source = 'user', updated_at = now()
    RETURNING id
  `;
  return { id: row.id as string, key };
}

export async function updateRule(id: string, rawValue: string): Promise<void> {
  const value = normaliseValue(rawValue);
  // The edit is attributed to the user, so a Context Builder re-run can tell a harvested rule
  // from one the owner has since rewritten.
  const [row] = await sql()`
    UPDATE standing_context SET value = ${value}, source = 'user', updated_at = now()
    WHERE id = ${id}
    RETURNING id
  `;
  if (!row) throw new RuleError(`Rule ${id} not found`);
}

/** Idempotent: deleting an already-deleted rule is not an error, the same as a note's soft
 *  delete - a replayed offline delete must not fail just because it already landed once. */
export async function deleteRule(id: string): Promise<void> {
  await sql()`DELETE FROM standing_context WHERE id = ${id}`;
}

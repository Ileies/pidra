import { db, contextCorrections, contacts, entities, standingContext } from "../db";
import { and, desc, eq, sql as drizzleSql } from "drizzle-orm";

/**
 * The correction layer over the harvested long-term context.
 *
 * The governing rule: harvested information is never overwritten, only adjusted and
 * complemented. The context document on disk and the `standing_context` values the Context
 * Builder wrote are therefore never rewritten here - corrections live in their own table and
 * are injected alongside the harvest, with the daily prompts told the correction wins.
 *
 * Structured rows (`entities`, `contacts`) are the one place a write does reach the harvested
 * row, because `phase3-context` and Section 2 read those rows directly and would otherwise keep
 * serving the wrong value. Even there the write is a field-level merge, the pre-merge row is
 * snapshotted into `previous_state`, and the row is locked against re-seeding.
 */

export const TARGET_KINDS = ["document", "standing_context", "entity", "contact"] as const;
export const OPERATIONS = ["amend", "complement", "retract"] as const;

export type TargetKind = (typeof TARGET_KINDS)[number];
export type Operation = (typeof OPERATIONS)[number];

export interface CorrectionInput {
  targetKind: TargetKind;
  targetKey: string;
  operation: Operation;
  statement: string;
  supersedesText?: string | null;
  rationale?: string | null;
  /** Field-level merge for structured targets, e.g. `{ relationship: "girlfriend" }`. */
  fields?: Record<string, unknown> | null;
  source?: string;
  conversationId?: string | null;
}

export interface ActiveCorrection {
  id: string;
  targetKind: string;
  targetKey: string;
  operation: string;
  statement: string;
  supersedesText: string | null;
  createdAt: string | null;
}

/** Only these columns can be merged into a row. Anything else is rejected rather than ignored. */
const MERGEABLE: Record<"entity" | "contact", string[]> = {
  entity: ["type", "domain", "summary", "importance", "status"],
  contact: ["name", "relationship", "priority", "contextNotes"],
};

export class CorrectionError extends Error {}

export async function listActiveCorrections(): Promise<ActiveCorrection[]> {
  return db
    .select({
      id: contextCorrections.id,
      targetKind: contextCorrections.targetKind,
      targetKey: contextCorrections.targetKey,
      operation: contextCorrections.operation,
      statement: contextCorrections.statement,
      supersedesText: contextCorrections.supersedesText,
      createdAt: contextCorrections.createdAt,
    })
    .from(contextCorrections)
    .where(eq(contextCorrections.status, "active"))
    .orderBy(desc(contextCorrections.createdAt));
}

/**
 * The shape handed to the daily synthesis prompts. The superseded text travels with the
 * correction on purpose: the model needs to see the wrong statement to recognise which part of
 * `long_term_context` it is being told to disregard.
 */
export function formatForPrompt(corrections: ActiveCorrection[]) {
  return corrections.map((c) => ({
    about: `${c.targetKind}:${c.targetKey}`,
    operation: c.operation,
    correct: c.statement,
    incorrect: c.supersedesText || null,
  }));
}

export async function recordCorrection(input: CorrectionInput): Promise<{ id: string; applied: string }> {
  const statement = input.statement.trim();
  if (!statement) throw new CorrectionError("statement is required");
  if (!TARGET_KINDS.includes(input.targetKind)) {
    throw new CorrectionError(`target_kind must be one of ${TARGET_KINDS.join(", ")}`);
  }
  if (!OPERATIONS.includes(input.operation)) {
    throw new CorrectionError(`operation must be one of ${OPERATIONS.join(", ")}`);
  }
  const targetKey = input.targetKey.trim();
  if (!targetKey) throw new CorrectionError("target_key is required");

  // The row merge runs first: if the target does not exist, nothing should be recorded.
  let previousState: Record<string, unknown> | null = null;
  let applied = "recorded as a correction over the harvested context";

  if (input.targetKind === "entity" || input.targetKind === "contact") {
    const merge = await mergeStructuredRow(input.targetKind, targetKey, input.fields ?? null);
    previousState = merge.previousState;
    applied = merge.applied;
  } else if (input.targetKind === "standing_context" && input.operation === "complement") {
    applied = await addStandingRule(targetKey, statement);
  }

  const [row] = await db
    .insert(contextCorrections)
    .values({
      targetKind: input.targetKind,
      targetKey,
      operation: input.operation,
      statement,
      supersedesText: input.supersedesText?.trim() || null,
      rationale: input.rationale?.trim() || null,
      previousState,
      source: input.source ?? "chat",
      conversationId: input.conversationId ?? null,
    })
    .returning({ id: contextCorrections.id });

  return { id: row.id, applied };
}

/**
 * `complement` on `standing_context` is genuinely new information rather than a correction of
 * something harvested, so it becomes a real row. Its key is namespaced under `user_` so it can
 * never collide with the Context Builder's `keep_rule_*` keys and get overwritten by a re-seed.
 */
async function addStandingRule(key: string, value: string): Promise<string> {
  const safeKey = key.startsWith("user_") ? key : `user_${key.replace(/[^a-z0-9_]+/gi, "_").toLowerCase()}`;

  const [existing] = await db
    .select({ value: standingContext.value })
    .from(standingContext)
    .where(eq(standingContext.key, safeKey))
    .limit(1);

  if (existing) {
    // Appending rather than replacing: an existing rule the user is adding to must keep what it
    // already said. Replacing it here would be exactly the overwrite this module exists to avoid.
    await db
      .update(standingContext)
      .set({ value: `${existing.value}\n${value}`, updatedAt: drizzleSql`now()` })
      .where(eq(standingContext.key, safeKey));
    return `appended to standing rule ${safeKey}`;
  }

  await db.insert(standingContext).values({ key: safeKey, value, source: "user" });
  return `added standing rule ${safeKey}`;
}

async function mergeStructuredRow(
  kind: "entity" | "contact",
  key: string,
  fields: Record<string, unknown> | null,
): Promise<{ previousState: Record<string, unknown> | null; applied: string }> {
  const allowed = MERGEABLE[kind];
  const patch: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(fields ?? {})) {
    if (!allowed.includes(k)) {
      throw new CorrectionError(`field "${k}" cannot be corrected on a ${kind}; allowed: ${allowed.join(", ")}`);
    }
    if (v !== null && v !== undefined && String(v).trim() !== "") patch[k] = v;
  }

  if (kind === "contact") {
    const [row] = await db.select().from(contacts).where(eq(contacts.identifier, key)).limit(1);
    if (!row) throw new CorrectionError(`no contact with identifier "${key}"`);
    if (Object.keys(patch).length === 0) {
      return { previousState: null, applied: "recorded as a correction; no contact field was named, so the row is unchanged" };
    }
    await db
      .update(contacts)
      .set({ ...patch, locked: true, updatedAt: drizzleSql`now()` })
      .where(eq(contacts.identifier, key));
    return { previousState: row as Record<string, unknown>, applied: `updated contact ${key}: ${Object.keys(patch).join(", ")} (row locked against re-seed)` };
  }

  // Entity names are matched case-insensitively: the graph holds "Acme" where a user says "acme".
  const [row] = await db
    .select()
    .from(entities)
    .where(drizzleSql`lower(${entities.name}) = lower(${key})`)
    .limit(1);
  if (!row) throw new CorrectionError(`no entity named "${key}"`);
  if (Object.keys(patch).length === 0) {
    return { previousState: null, applied: "recorded as a correction; no entity field was named, so the row is unchanged" };
  }
  await db.update(entities).set({ ...patch, locked: true }).where(eq(entities.id, row.id));
  return { previousState: row as Record<string, unknown>, applied: `updated entity ${row.name}: ${Object.keys(patch).join(", ")} (row locked against re-seed)` };
}

/**
 * Reverting flips the status and puts the structured row back exactly as it was. The correction
 * row itself stays - a reverted correction is still part of the record.
 */
export async function revertCorrection(id: string): Promise<string> {
  const [row] = await db.select().from(contextCorrections).where(eq(contextCorrections.id, id)).limit(1);
  if (!row) throw new CorrectionError(`no correction with id ${id}`);
  if (row.status !== "active") throw new CorrectionError(`correction ${id} is already ${row.status}`);

  let restored = "";
  const prev = row.previousState;

  if (prev && row.targetKind === "contact") {
    await db
      .update(contacts)
      .set({
        name: (prev.name as string) ?? null,
        relationship: (prev.relationship as string) ?? null,
        priority: (prev.priority as string) ?? null,
        contextNotes: (prev.contextNotes as string) ?? null,
        locked: (prev.locked as boolean) ?? false,
        updatedAt: drizzleSql`now()`,
      })
      .where(eq(contacts.identifier, row.targetKey));
    restored = `, contact ${row.targetKey} restored`;
  } else if (prev && row.targetKind === "entity") {
    await db
      .update(entities)
      .set({
        type: (prev.type as string) ?? null,
        domain: (prev.domain as string) ?? null,
        summary: (prev.summary as string) ?? null,
        importance: (prev.importance as string) ?? null,
        status: (prev.status as string) ?? null,
        locked: (prev.locked as boolean) ?? false,
      })
      .where(eq(entities.id, prev.id as string));
    restored = `, entity ${row.targetKey} restored`;
  }

  await db
    .update(contextCorrections)
    .set({ status: "reverted", revertedAt: drizzleSql`now()` })
    .where(and(eq(contextCorrections.id, id), eq(contextCorrections.status, "active")));

  // A standing rule added by `complement` is deliberately left in place: it is additive
  // information the user asked for, not an edit to anything, and deleting it here would lose it.
  const note = row.targetKind === "standing_context" && row.operation === "complement"
    ? ", the standing rule it added was kept (delete it on /context-builder if unwanted)"
    : "";

  return `Correction ${id} reverted${restored}${note}.`;
}

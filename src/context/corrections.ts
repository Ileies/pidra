import { db, contextCorrections, contacts, entities } from "../db";
import { and, desc, eq, sql as drizzleSql } from "drizzle-orm";

/**
 * The correction layer over the harvested long-term context.
 *
 * The governing rule: harvested information is never overwritten, only adjusted and
 * complemented. The context document the Context Builder wrote is therefore never rewritten
 * here - corrections live in their own table and are injected alongside the harvest, with the
 * daily prompts told the correction wins. (The standing rules it found in Keep are not covered:
 * they are notes, and `src/notes/store.ts` handles their history.)
 *
 * Structured rows (`entities`, `contacts`) are the one place a write does reach the harvested
 * row, because `phase3-context` and Section 2 read those rows directly and would otherwise keep
 * serving the wrong value. Even there the write is a field-level merge, the pre-merge row is
 * snapshotted into `previous_state`, and the row is locked against re-seeding.
 */

export const TARGET_KINDS = ["document", "entity", "contact"] as const;
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
  /**
   * Take the entity (archive it) or the contact (set `removed_at`) out of use. Never a delete: the
   * row stays, locked, with its pre-removal state on the correction so a revert puts it back.
   */
  remove?: boolean;
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
    const merge = await mergeStructuredRow(input.targetKind, targetKey, input.fields ?? null, input.remove ?? false);
    previousState = merge.previousState;
    applied = merge.applied;
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

/** Only the fields that actually differ from the current row belong in a merge patch. */
function diffFromRow(candidate: Record<string, unknown>, row: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(candidate)) {
    if (row[k] !== v) patch[k] = v;
  }
  return patch;
}

async function mergeStructuredRow(
  kind: "entity" | "contact",
  key: string,
  fields: Record<string, unknown> | null,
  remove: boolean,
): Promise<{ previousState: Record<string, unknown> | null; applied: string }> {
  const allowed = MERGEABLE[kind];
  const candidate: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(fields ?? {})) {
    if (!allowed.includes(k)) {
      throw new CorrectionError(`field "${k}" cannot be corrected on a ${kind}; allowed: ${allowed.join(", ")}`);
    }
    if (v !== null && v !== undefined && String(v).trim() !== "") candidate[k] = v;
  }

  if (kind === "contact") {
    const [row] = await db.select().from(contacts).where(eq(contacts.identifier, key)).limit(1);
    if (!row) throw new CorrectionError(`no contact with identifier "${key}"`);
    if (remove) {
      if (row.removedAt) throw new CorrectionError(`contact ${key} is already removed`);
      await db
        .update(contacts)
        .set({ removedAt: drizzleSql`now()`, locked: true, updatedAt: drizzleSql`now()` })
        .where(eq(contacts.identifier, key));
      return { previousState: row as Record<string, unknown>, applied: `removed contact ${key} (the row is kept, locked, and comes back if this correction is reverted)` };
    }
    if (row.removedAt) throw new CorrectionError(`contact ${key} was removed; revert that removal before editing it`);
    const patch = diffFromRow(candidate, row as Record<string, unknown>);
    if (Object.keys(patch).length === 0) {
      return { previousState: null, applied: "recorded as a correction; no contact field actually changed, so the row is unchanged" };
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
  if (remove) {
    if (row.status === "archived") throw new CorrectionError(`entity ${row.name} is already removed`);
    await db.update(entities).set({ status: "archived", locked: true }).where(eq(entities.id, row.id));
    return { previousState: row as Record<string, unknown>, applied: `removed entity ${row.name} (archived and locked; it comes back if this correction is reverted)` };
  }
  const patch = diffFromRow(candidate, row as Record<string, unknown>);
  if (Object.keys(patch).length === 0) {
    return { previousState: null, applied: "recorded as a correction; no entity field actually changed, so the row is unchanged" };
  }
  await db.update(entities).set({ ...patch, locked: true }).where(eq(entities.id, row.id));
  return { previousState: row as Record<string, unknown>, applied: `updated entity ${row.name}: ${Object.keys(patch).join(", ")} (row locked against re-seed)` };
}

const EMAIL_SHAPED = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

/** The previous state of a contact that did not exist before the correction. */
const CREATED_MARKER = { __created: true };

export interface NewContact {
  identifier: string;
  name?: string | null;
  relationship?: string | null;
  priority?: string | null;
  contextNotes?: string | null;
  rationale?: string | null;
  source?: string;
  conversationId?: string | null;
}

/**
 * Adds a sender the directory does not have, or brings back one that was removed. It is a
 * `complement` correction like any other, so the log shows who added it and a revert takes it out
 * again (as a removal: the row stays).
 */
export async function addContact(input: NewContact): Promise<{ id: string; applied: string }> {
  const identifier = input.identifier.trim().toLowerCase();
  if (!EMAIL_SHAPED.test(identifier)) throw new CorrectionError(`"${input.identifier}" is not an email address; contacts are an email sender directory`);
  const priority = input.priority?.trim() || "normal";
  if (!["critical", "high", "normal", "low"].includes(priority)) throw new CorrectionError("priority must be critical, high, normal or low");

  const values = {
    name: input.name?.trim() || null,
    relationship: input.relationship?.trim() || null,
    priority,
    contextNotes: input.contextNotes?.trim() || null,
  };

  const [existing] = await db.select().from(contacts).where(eq(contacts.identifier, identifier)).limit(1);
  let previousState: Record<string, unknown>;
  let applied: string;

  if (existing && !existing.removedAt) {
    throw new CorrectionError(`contact ${identifier} already exists; use revise_context to change it`);
  } else if (existing) {
    previousState = existing as Record<string, unknown>;
    await db
      .update(contacts)
      .set({ ...values, removedAt: null, locked: true, updatedAt: drizzleSql`now()` })
      .where(eq(contacts.identifier, identifier));
    applied = `restored previously removed contact ${identifier}`;
  } else {
    previousState = CREATED_MARKER;
    await db.insert(contacts).values({ identifier, ...values, locked: true });
    applied = `added contact ${identifier} (locked against re-seed)`;
  }

  const described = [values.name, values.relationship].filter(Boolean).join(", ");
  const [row] = await db
    .insert(contextCorrections)
    .values({
      targetKind: "contact",
      targetKey: identifier,
      operation: "complement",
      statement: `${identifier} is ${described || "a known contact"}.`,
      rationale: input.rationale?.trim() || null,
      previousState,
      source: input.source ?? "chat",
      conversationId: input.conversationId ?? null,
    })
    .returning({ id: contextCorrections.id });

  return { id: row.id, applied };
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

  if (prev && row.targetKind === "contact" && prev.__created === true) {
    // Added by `addContact`: there is no earlier row to restore, so it is taken out of use again.
    await db
      .update(contacts)
      .set({ removedAt: drizzleSql`now()`, updatedAt: drizzleSql`now()` })
      .where(eq(contacts.identifier, row.targetKey));
    restored = `, contact ${row.targetKey} removed again`;
  } else if (prev && row.targetKind === "contact") {
    await db
      .update(contacts)
      .set({
        name: (prev.name as string) ?? null,
        relationship: (prev.relationship as string) ?? null,
        priority: (prev.priority as string) ?? null,
        contextNotes: (prev.contextNotes as string) ?? null,
        removedAt: (prev.removedAt as string) ?? null,
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

  return `Correction ${id} reverted${restored}.`;
}

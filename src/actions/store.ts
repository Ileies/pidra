/**
 * The single writer for `report_actions`.
 *
 * Two parties write the table and neither may undo the other. The pipeline inserts proposals,
 * and a re-run of the same date replaces only the rows nobody has acted on. The reader resolves
 * them from the report: a tap runs the skill, a dismissal hides the button. A done or dismissed
 * row survives every re-run, and a new proposal for the same thing is discarded against it
 * instead of reappearing the next time the pipeline runs that day.
 *
 * A tap goes through `executeSkill()` like every other skill call, so the audit log, the enabled
 * switch on /skills and the risk tiers all apply. No surface is passed: surfaces bound what the
 * chat may reach for, while a row's skill is always one of `SKILL_FOR`, fixed in code, and
 * `update_calendar_event` deliberately stays off the chat's list (it has no way to look up an
 * event id). It is attributed to the user: the model proposed it, but the reader pressed it.
 */
import { and, eq, inArray, lt, or, sql } from "drizzle-orm";
import { db, reportActions } from "../db";
import { executeSkill } from "../skills/execute";
import { sameThing, type ActionKind, type Proposal } from "./propose";

export type ReportAction = typeof reportActions.$inferSelect;

/** Nobody has acted on these, so a re-run may replace them. */
const REPLACEABLE = ["proposed", "failed", "discarded"];
/** A tap may run these. `failed` is a retry. */
const RUNNABLE = ["proposed", "failed"];
/** A claim older than this was lost to a crash or a restart and may be taken again. */
const STALE_RUNNING = sql`now() - interval '2 minutes'`;

export class ActionError extends Error {
  constructor(readonly kind: "not_found" | "conflict", message: string) {
    super(message);
  }
}

/** Replaces the date's unresolved proposals with `proposals`. Idempotent, so `withRetry` may repeat it. */
export async function saveProposals(runDate: string, proposals: Proposal[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(reportActions)
      .where(and(eq(reportActions.runDate, runDate), inArray(reportActions.status, REPLACEABLE)));
    const settled = await tx.select().from(reportActions).where(eq(reportActions.runDate, runDate));

    if (proposals.length === 0) return;
    await tx.insert(reportActions).values(
      proposals.map((p) => {
        const handled =
          p.discarded === null &&
          settled.some((row) => sameThing({ kind: row.kind as ActionKind, parameters: row.parameters, preview: row.preview }, p));
        const discarded = handled ? "already_handled" : p.discarded;
        return {
          runDate,
          kind: p.kind,
          skillName: p.skillName,
          parameters: p.parameters,
          preview: p.preview,
          reason: p.reason || null,
          sourceExtractionIds: p.sourceExtractionIds,
          status: discarded ? "discarded" : "proposed",
          statusDetail: discarded,
        };
      }),
    );
  });
}

async function find(id: string): Promise<ReportAction> {
  const [row] = await db.select().from(reportActions).where(eq(reportActions.id, id));
  // A discarded row was never offered, so to the reader it does not exist.
  if (!row || row.status === "discarded") {
    throw new ActionError("not_found", "This action no longer exists. A newer run of the pipeline may have replaced it.");
  }
  return row;
}

/**
 * Runs the action's skill, once. The claim is one conditional UPDATE, so a double tap or a second
 * device cannot add the same event twice: whoever loses the claim is told what the row says now.
 */
export async function runAction(id: string): Promise<{ action: ReportAction; message: string }> {
  const [claimed] = await db
    .update(reportActions)
    .set({ status: "running", updatedAt: sql`now()` })
    .where(
      and(
        eq(reportActions.id, id),
        or(
          inArray(reportActions.status, RUNNABLE),
          and(eq(reportActions.status, "running"), lt(reportActions.updatedAt, STALE_RUNNING)),
        ),
      ),
    )
    .returning();

  if (!claimed) {
    const row = await find(id);
    if (row.status === "done") return { action: row, message: row.statusDetail ?? "Already done" };
    throw new ActionError("conflict", row.status === "running" ? "This action is already running." : `This action is ${row.status}.`);
  }

  const outcome = await executeSkill(claimed.skillName, claimed.parameters, "quick_action", {
    runDate: claimed.runDate,
    actor: "user",
  });

  // A skill raised to `high` on /skills since the proposal was made lands in the approval queue.
  const status = outcome.status === "executed" ? "done" : outcome.status === "pending_confirmation" ? "queued" : "failed";
  const [action] = await db
    .update(reportActions)
    .set({ status, statusDetail: outcome.message, skillExecutionId: outcome.executionId ?? null, updatedAt: sql`now()` })
    .where(eq(reportActions.id, id))
    .returning();

  console.log(`[Actions] ${claimed.kind} ${id}: ${status} - ${outcome.message.slice(0, 120)}`);
  return { action, message: outcome.message };
}

async function transition(id: string, from: string[], to: string): Promise<ReportAction> {
  const [row] = await db
    .update(reportActions)
    .set({ status: to, updatedAt: sql`now()` })
    .where(and(eq(reportActions.id, id), inArray(reportActions.status, from)))
    .returning();
  if (row) return row;
  const current = await find(id);
  if (current.status === to) return current;
  throw new ActionError("conflict", `This action is ${current.status}.`);
}

/** Hides the button. Reversible with `restoreAction`, which is what the dashboard's undo calls. */
export function dismissAction(id: string): Promise<ReportAction> {
  return transition(id, RUNNABLE, "dismissed");
}

export function restoreAction(id: string): Promise<ReportAction> {
  return transition(id, ["dismissed"], "proposed");
}

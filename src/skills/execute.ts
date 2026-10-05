import { errMessage } from "../util/text";
import { eq } from "drizzle-orm";
import { db, skillExecutions } from "../db";
import { getSkill, type Skill, type SkillContext } from "./loader";
import { getEffectiveSkill } from "./overrides";
import { isSkillAllowed, SURFACES, type Surface } from "../ai/surfaces";
import { timeZoneOrUtc, utcDay } from "../util/time";

export type ExecutionStatus = "executed" | "failed" | "rejected" | "pending_confirmation" | "unknown_skill";

export interface ExecutionOutcome {
  status: ExecutionStatus;
  /** Human-readable result or reason. Goes back to the caller and, for chat, to the model. */
  message: string;
  executionId?: string;
}

export interface ExecutionOptions {
  /** The conversation a chat-triggered call belongs to, recorded on whatever the skill writes. */
  conversationId?: string | null;
  /** The pipeline run this call belongs to. Defaults to today, which is wrong for a backfill. */
  runDate?: string;
  /**
   * The dashboard page the call came from. When set, only that surface's skills may run - the
   * check lives here rather than in the chat loop so no later caller can bypass it, and because
   * the surface arrives from a client and is therefore untrusted.
   */
  surface?: Surface;
  /**
   * Who the write is attributed to, when `triggeredBy` does not say. A quick action is proposed by
   * the pipeline but run because the owner tapped it, so it is theirs.
   */
  actor?: SkillContext["actor"];
  /** The caller's IANA zone, for a time without an offset. A chat turn passes the browser's; default UTC. */
  timeZone?: string;
}

/** Updates the audit row. `result` is left as it was when omitted. */
const settle = (id: string, status: string, result?: string) =>
  db.update(skillExecutions).set({ status, ...(result === undefined ? {} : { result }) }).where(eq(skillExecutions.id, id));

/** Records a rejection on the audit row and answers with it. */
async function reject(id: string, message: string): Promise<ExecutionOutcome> {
  await settle(id, "rejected", message);
  return { status: "rejected", message, executionId: id };
}

/** Runs the skill and records how it went. A throwing skill is a `failed` outcome, not an error. */
async function runSkill(skill: Skill, parameters: Record<string, unknown>, ctx: SkillContext): Promise<ExecutionOutcome> {
  try {
    const result = await skill.execute(parameters, ctx);
    await settle(ctx.executionId, "executed", result);
    return { status: "executed", message: result, executionId: ctx.executionId };
  } catch (err) {
    const message = errMessage(err);
    await settle(ctx.executionId, "failed", message);
    return { status: "failed", message, executionId: ctx.executionId };
  }
}

/**
 * The single path every skill call takes (REST bridge, pipeline, chat); gating lives here so no
 * caller can bypass it (docs/skills.md). Order matters: audit row (`pending`) first, then disabled,
 * surface, risk gates, so a rejected call is still on record. Never throws for a skill failure:
 * see `ExecutionOutcome.status` (`high` risk parks the row as `pending` for `resolvePendingSkill`).
 */
export async function executeSkill(
  skillName: string,
  parameters: Record<string, unknown>,
  triggeredBy: string,
  options: ExecutionOptions = {},
): Promise<ExecutionOutcome> {
  const skill = getSkill(skillName);
  if (!skill) return { status: "unknown_skill", message: `Unknown skill: ${skillName}` };

  const effective = await getEffectiveSkill(skillName);
  const riskLevel = effective?.risk_level ?? skill.risk_level;

  const runDate = options.runDate ?? utcDay();
  const [execRow] = await db
    .insert(skillExecutions)
    .values({ runDate, skillName, parameters, status: "pending", triggeredBy })
    .returning({ id: skillExecutions.id });

  // Disabled from /skills: checked first, whatever the risk level.
  if (effective && !effective.enabled) return reject(execRow.id, `${skillName} is disabled`);

  // Surface policy before risk level; the rejection is logged so a too-tight policy shows on /skills.
  if (options.surface && !isSkillAllowed(options.surface, skillName)) {
    return reject(execRow.id, `${skillName} is not available on the ${options.surface} page (allowed there: ${SURFACES[options.surface].skills.join(", ")})`);
  }

  if (riskLevel === "critical") {
    await settle(execRow.id, "rejected");
    return {
      status: "rejected",
      message: "critical skills require manual review and cannot be auto-executed",
      executionId: execRow.id,
    };
  }

  if (riskLevel === "high") {
    return {
      status: "pending_confirmation",
      message: "high-risk skill requires confirmation before it runs; it is queued on /skills",
      executionId: execRow.id,
    };
  }

  if (riskLevel === "medium") {
    console.log(`[Skills] Medium-risk skill executed: ${skillName} - triggered_by=${triggeredBy}`);
  }

  return runSkill(skill, parameters, {
    executionId: execRow.id,
    triggeredBy,
    conversationId: options.conversationId ?? null,
    // A write from the chat is the assistant's, anything else is the system acting on its own,
    // unless the caller knows better.
    actor: options.actor ?? (triggeredBy === "chat" ? "chat" : "system"),
    timeZone: timeZoneOrUtc(options.timeZone),
  });
}

/**
 * Runs or rejects a queued high-risk call (a `pending` `skill_executions` row). Disabled and
 * critical are re-checked at confirmation time; the surface check is not repeated. Not idempotent:
 * a row that is no longer `pending` is answered with `rejected`.
 */
export async function resolvePendingSkill(
  executionId: string,
  decision: "confirm" | "reject",
  reason?: string,
): Promise<ExecutionOutcome> {
  const [row] = await db.select().from(skillExecutions).where(eq(skillExecutions.id, executionId));
  if (!row) return { status: "unknown_skill", message: `No such skill execution: ${executionId}` };
  if (row.status !== "pending") {
    return { status: "rejected", message: `Execution ${executionId} is already ${row.status}`, executionId };
  }

  if (decision === "reject") return reject(executionId, reason?.trim() || "Rejected by the owner");

  const skillName = row.skillName ?? "";
  const skill = getSkill(skillName);
  if (!skill) {
    const message = `Unknown skill: ${skillName}`;
    await settle(executionId, "failed", message);
    return { status: "unknown_skill", message, executionId };
  }

  const effective = await getEffectiveSkill(skillName);
  if (effective && !effective.enabled) return reject(executionId, `${skillName} has been disabled since this call was queued`);
  if ((effective?.risk_level ?? skill.risk_level) === "critical") {
    return reject(executionId, `${skillName} is now critical and cannot be run, even with confirmation`);
  }

  return runSkill(skill, (row.parameters ?? {}) as Record<string, unknown>, {
    executionId,
    triggeredBy: row.triggeredBy ?? "manual",
    conversationId: null,
    // The owner pressed Confirm, so the write is theirs however the call was originally proposed.
    actor: "user",
    timeZone: "UTC",
  });
}

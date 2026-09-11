import { eq } from "drizzle-orm";
import { db, skillExecutions } from "../db";
import { getSkill, type SkillContext } from "./loader";
import { getEffectiveSkill } from "./overrides";
import { isSkillAllowed, SURFACES, type Surface } from "../ai/surfaces";

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
}

/**
 * The single path every skill call takes, whether it comes from the REST bridge, the pipeline or
 * the chat. Risk gating, the surface policy and the `skill_executions` audit log live here so a
 * second caller cannot accidentally bypass any of them.
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

  const runDate = options.runDate ?? new Date().toISOString().split("T")[0];
  const [execRow] = await db
    .insert(skillExecutions)
    .values({ runDate, skillName, parameters, status: "pending", triggeredBy })
    .returning({ id: skillExecutions.id });

  // Disabled from /skills. Checked before anything else - a skill an operator turned off must
  // not run just because it's otherwise low-risk and surface-allowed.
  if (effective && !effective.enabled) {
    const message = `${skillName} is disabled`;
    await db.update(skillExecutions).set({ status: "rejected", result: message }).where(eq(skillExecutions.id, execRow.id));
    return { status: "rejected", message, executionId: execRow.id };
  }

  // The surface policy is checked before the risk level: a skill that does not belong on the page
  // must not run even if it is harmless elsewhere. The rejection is logged rather than swallowed,
  // so a policy that is too tight shows up on /skills instead of as silent weirdness.
  if (options.surface && !isSkillAllowed(options.surface, skillName)) {
    const message = `${skillName} is not available on the ${options.surface} page (allowed there: ${SURFACES[options.surface].skills.join(", ")})`;
    await db.update(skillExecutions).set({ status: "rejected", result: message }).where(eq(skillExecutions.id, execRow.id));
    return { status: "rejected", message, executionId: execRow.id };
  }

  // Risk level: the dashboard override (if any) always wins over the code-defined default.
  if (riskLevel === "critical") {
    await db.update(skillExecutions).set({ status: "rejected" }).where(eq(skillExecutions.id, execRow.id));
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

  const ctx: SkillContext = {
    executionId: execRow.id,
    triggeredBy,
    conversationId: options.conversationId ?? null,
    // A write from the chat is the assistant's, anything else is the system acting on its own.
    actor: triggeredBy === "chat" ? "chat" : "system",
  };

  try {
    const result = await skill.execute(parameters, ctx);
    await db.update(skillExecutions).set({ status: "executed", result }).where(eq(skillExecutions.id, execRow.id));
    return { status: "executed", message: result, executionId: execRow.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.update(skillExecutions).set({ status: "failed", result: msg }).where(eq(skillExecutions.id, execRow.id));
    return { status: "failed", message: msg, executionId: execRow.id };
  }
}

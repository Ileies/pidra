import { eq } from "drizzle-orm";
import { db, skillExecutions } from "../db";
import { getSkill } from "./loader";

export type ExecutionStatus = "executed" | "failed" | "rejected" | "pending_confirmation" | "unknown_skill";

export interface ExecutionOutcome {
  status: ExecutionStatus;
  /** Human-readable result or reason. Goes back to the caller and, for chat, to the model. */
  message: string;
  executionId?: string;
}

/**
 * The single path every skill call takes, whether it comes from the REST bridge or from the
 * chat. Risk gating and the `skill_executions` audit log live here so a second caller cannot
 * accidentally bypass either.
 */
export async function executeSkill(
  skillName: string,
  parameters: Record<string, unknown>,
  triggeredBy: string,
): Promise<ExecutionOutcome> {
  const skill = getSkill(skillName);
  if (!skill) return { status: "unknown_skill", message: `Unknown skill: ${skillName}` };

  const today = new Date().toISOString().split("T")[0];
  const [execRow] = await db
    .insert(skillExecutions)
    .values({ runDate: today, skillName, parameters, status: "pending", triggeredBy })
    .returning({ id: skillExecutions.id });

  if (skill.risk_level === "critical") {
    await db.update(skillExecutions).set({ status: "rejected" }).where(eq(skillExecutions.id, execRow.id));
    return {
      status: "rejected",
      message: "critical skills require manual review and cannot be auto-executed",
      executionId: execRow.id,
    };
  }

  if (skill.risk_level === "high") {
    return {
      status: "pending_confirmation",
      message: "high-risk skill requires confirmation before it runs; it is queued on /skills",
      executionId: execRow.id,
    };
  }

  if (skill.risk_level === "medium") {
    console.log(`[Skills] Medium-risk skill executed: ${skillName} - triggered_by=${triggeredBy}`);
  }

  try {
    const result = await skill.execute(parameters);
    await db.update(skillExecutions).set({ status: "executed", result }).where(eq(skillExecutions.id, execRow.id));
    return { status: "executed", message: result, executionId: execRow.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.update(skillExecutions).set({ status: "failed", result: msg }).where(eq(skillExecutions.id, execRow.id));
    return { status: "failed", message: msg, executionId: execRow.id };
  }
}

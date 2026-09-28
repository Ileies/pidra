import { db, skillExecutions } from "../../db";
import { getSkill } from "../../skills/loader";
import { executeSkill } from "../../skills/execute";

export async function processSkillSuggestions(
  suggestions: { skill: string; reason: string; parameters: Record<string, unknown> }[],
  runDate: string,
  triggeredBy: string,
): Promise<void> {
  for (const suggestion of suggestions) {
    const skill = getSkill(suggestion.skill);
    if (!skill) {
      console.warn(`[Phase 6] Unknown skill suggestion: ${suggestion.skill} - skipped`);
      continue;
    }

    if (skill.risk_level === "low") {
      // Through the shared choke point, which owns the audit row and the risk gating. Only `low`
      // reaches it: a medium-risk skill must not auto-run off a model suggestion, which is why
      // the branch below still just logs one for review.
      const outcome = await executeSkill(skill.name, suggestion.parameters, triggeredBy, { runDate });
      if (outcome.status === "executed") {
        console.log(`[Phase 6] Skill executed: ${skill.name} - ${outcome.message.slice(0, 80)}`);
      } else {
        console.error(`[Phase 6] Skill ${outcome.status}: ${skill.name} - ${outcome.message}`);
      }
    } else {
      // Medium/high/critical: log as pending for manual review
      await db.insert(skillExecutions).values({
        runDate,
        skillName: skill.name,
        parameters: suggestion.parameters,
        status: "pending",
        triggeredBy,
      });
      console.log(`[Phase 6] Skill suggestion logged (${skill.risk_level}, manual review): ${skill.name}`);
    }
  }
}

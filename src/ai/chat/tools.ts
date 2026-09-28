import type { FunctionTool } from "../openai";
import { listEffectiveSkills, type EffectiveSkill } from "../../skills/overrides";
import { SURFACES, type Surface } from "../surfaces";

function toJsonSchema(skill: EffectiveSkill): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [name, param] of Object.entries(skill.parameters)) {
    properties[name] = { type: param.type, description: param.description ?? "" };
    if (param.required) required.push(name);
  }

  // `strict: false` below, so optional parameters can simply be omitted by the model.
  return { type: "object", properties, required, additionalProperties: false };
}

/**
 * Only this surface's skills, so the model cannot announce an edit it is not allowed to make.
 * Goes through the override layer so a skill disabled from /skills is never offered, and an
 * edited description/risk level reaches the model exactly as an operator set it.
 */
export async function skillTools(surface: Surface): Promise<FunctionTool[]> {
  const allowed = new Set(SURFACES[surface].skills);
  const skills = await listEffectiveSkills();
  return skills
    .filter((skill) => allowed.has(skill.name) && skill.enabled)
    .map((skill) => ({
      type: "function" as const,
      name: skill.name,
      description: `${skill.description} (risk: ${skill.risk_level})`,
      parameters: toJsonSchema(skill),
      strict: false,
    }));
}

/** Which stores a turn wrote, so the dashboard knows whether the page it is on went stale. */
export const SKILL_TOUCHES: Record<string, string[]> = {
  write_note: ["notes"],
  update_note: ["notes"],
  delete_note: ["notes"],
  restore_note: ["notes"],
  revise_context: ["context", "entities"],
  revert_context_revision: ["context", "entities"],
  set_source_active: ["sources"],
  propose_prompt_version: ["prompts"],
  add_todo_item: ["todos"],
  complete_todo_item: ["todos"],
  add_calendar_event: ["calendar"],
};

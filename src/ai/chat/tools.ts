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
 * Goes through the effective-skill layer so a skill disabled from /skills is never offered.
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

/**
 * Which stores a turn wrote, so the dashboard knows whether the page it is on went stale. Returned
 * as `touched` in the chat events; a skill that writes but is missing here never invalidates a page.
 * Keys are store names the dashboard matches on (keep in sync when adding a writing skill).
 */
export const SKILL_TOUCHES: Record<string, string[]> = {
  write_note: ["notes"],
  update_note: ["notes"],
  delete_note: ["notes"],
  restore_note: ["notes"],
  revise_context: ["context", "entities", "contacts"],
  revert_context_revision: ["context", "entities", "contacts"],
  remove_context_item: ["context", "entities", "contacts"],
  add_contact: ["context", "contacts"],
  create_question: ["questions"],
  set_source_active: ["sources"],
  add_todo_item: ["todos"],
  complete_todo_item: ["todos"],
  update_todo_item: ["todos"],
  delete_todo_item: ["todos"],
  add_calendar_event: ["calendar"],
  update_calendar_event: ["calendar"],
  delete_calendar_event: ["calendar"],
};

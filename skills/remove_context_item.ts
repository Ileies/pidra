import type { Skill } from "../src/skills/loader";
import { recordCorrection } from "../src/context/corrections";

/**
 * "Delete" for the structured context. Nothing is erased: an entity is archived and a contact gets
 * `removed_at`, both locked against a re-seed, with the pre-removal row on the correction so
 * `revert_context_revision` puts it back. A sentence in the context document is not removed here -
 * that is `revise_context` with operation 'retract'.
 */
const skill: Skill = {
  name: "remove_context_item",
  description:
    "Remove an entity or a contact from use: the daily briefings stop seeing it. The row is kept (archived or marked removed, locked against a re-seed) and the removal is reversible with revert_context_revision. " +
    "Use read_context first so target_key is the exact entity name or contact email address. To drop a single sentence of the context document or a standing rule, use revise_context with operation 'retract' instead.",
  risk_level: "medium",
  parameters: {
    target_kind: { type: "string", required: true, description: "entity | contact" },
    target_key: { type: "string", required: true, description: "Entity name, or contact email address" },
    rationale: { type: "string", required: true, description: "Why it is removed, from what the user said" },
  },
  execute: async (params, ctx) => {
    const kind = String(params.target_kind ?? "");
    if (kind !== "entity" && kind !== "contact") throw new Error("target_kind must be entity or contact");
    const key = String(params.target_key ?? "").trim();
    const rationale = String(params.rationale ?? "").trim();
    if (!rationale) throw new Error("rationale is required");

    const result = await recordCorrection({
      targetKind: kind,
      targetKey: key,
      operation: "retract",
      statement: `The ${kind} "${key}" was removed at the user's request and must not be used or mentioned. Reason: ${rationale}`,
      rationale,
      remove: true,
      source: ctx.triggeredBy,
      conversationId: ctx.conversationId ?? null,
    });

    return `Correction ${result.id} recorded - ${result.applied}. Reversible with revert_context_revision.`;
  },
};

export default skill;

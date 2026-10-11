import type { Skill } from "../src/skills/loader";
import { recordCorrection } from "../src/context/corrections";

/**
 * "Delete" for a contact. Nothing is erased: the contact gets `removed_at`, locked against a
 * re-seed, with the pre-removal row on the correction so `revert_context_revision` puts it back. A
 * sentence in the context document is not removed here - that is `revise_context` with operation
 * 'retract'.
 */
const skill: Skill = {
  name: "remove_context_item",
  description:
    "Remove a contact from use: the daily briefings stop seeing it. The row is kept (marked removed, locked against a re-seed) and the removal is reversible with revert_context_revision. " +
    "Use read_context first so target_key is the exact contact email address. To drop a single sentence of the context document, use revise_context with operation 'retract' instead (a standing rule or background on a name is a note: use delete_note).",
  risk_level: "medium",
  touches: ["context", "contacts"],
  parameters: {
    target_key: { type: "string", required: true, description: "Contact email address" },
    rationale: { type: "string", required: true, description: "Why it is removed, from what the user said" },
  },
  execute: async (params, ctx) => {
    const key = String(params.target_key ?? "").trim();
    const rationale = String(params.rationale ?? "").trim();
    if (!rationale) throw new Error("rationale is required");

    const result = await recordCorrection({
      targetKind: "contact",
      targetKey: key,
      operation: "retract",
      statement: `The contact "${key}" was removed at the user's request and must not be used or mentioned. Reason: ${rationale}`,
      rationale,
      remove: true,
      source: ctx.triggeredBy,
      conversationId: ctx.conversationId ?? null,
    });

    return `Correction ${result.id} recorded - ${result.applied}. Reversible with revert_context_revision.`;
  },
};

export default skill;

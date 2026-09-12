import type { Skill } from "../src/skills/loader";
import { recordCorrection, TARGET_KINDS, OPERATIONS, type TargetKind, type Operation } from "../src/context/corrections";

/**
 * Surgical revision of the harvested context. Nothing is overwritten: the correction is stored
 * in its own layer and injected alongside the harvest, which the daily prompts are told to
 * treat as outranked. Structured rows get a field-level merge with a restore snapshot.
 */
const skill: Skill = {
  name: "revise_context",
  description:
    "Correct one fact in the harvested long-term context. The harvest is never overwritten - the correction is layered over it and outranks it in every daily briefing. " +
    "Record exactly one fact per call. Always run read_context first so target_key is real and supersedes quotes the actual wrong wording.",
  risk_level: "medium",
  parameters: {
    target_kind: { type: "string", required: true, description: `One of: ${TARGET_KINDS.join(" | ")}` },
    target_key: { type: "string", required: true, description: "Document heading, standing_context key, entity name, or contact email address" },
    operation: { type: "string", required: true, description: "amend (harvest is wrong) | complement (harvest is incomplete) | retract (harvest states something false)" },
    statement: { type: "string", required: true, description: "The correct fact, written as a plain statement about the user. This is injected verbatim into daily briefings." },
    supersedes: { type: "string", required: false, description: "The wrong text, quoted from the harvest. Required in practice for amend and retract - it is how the briefing knows what to disregard." },
    rationale: { type: "string", required: false, description: "Why this correction was made, from the conversation" },
    fields: { type: "string", required: false, description: 'JSON object of row fields to merge, for entity (type, domain, summary, importance, status) or contact (name, relationship, priority, contextNotes) targets. Example: {"relationship":"girlfriend"}' },
  },
  execute: async (params, ctx) => {
    let fields: Record<string, unknown> | null = null;
    if (params.fields) {
      const raw = String(params.fields).trim();
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            throw new Error("not an object");
          }
          fields = parsed as Record<string, unknown>;
        } catch (err) {
          throw new Error(`fields must be a JSON object: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    const result = await recordCorrection({
      targetKind: String(params.target_kind ?? "") as TargetKind,
      targetKey: String(params.target_key ?? ""),
      operation: String(params.operation ?? "") as Operation,
      statement: String(params.statement ?? ""),
      supersedesText: params.supersedes ? String(params.supersedes) : null,
      rationale: params.rationale ? String(params.rationale) : null,
      fields,
      source: ctx.triggeredBy,
      // Provenance comes from the execution context now, so a correction always points back at
      // the conversation that produced it without the chat having to inject a parameter.
      conversationId: ctx.conversationId ?? null,
    });

    return `Correction ${result.id} recorded - ${result.applied}. It applies from the next briefing and is reversible with revert_context_revision. Valid operations: ${OPERATIONS.join(", ")}.`;
  },
};

export default skill;

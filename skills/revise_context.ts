import { errMessage } from "../src/util/text";
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
    target_key: { type: "string", required: true, description: "Document heading, entity name, or contact email address" },
    operation: { type: "string", required: true, description: "amend (harvest is wrong) | complement (harvest is incomplete) | retract (harvest states something false)" },
    statement: { type: "string", required: true, description: "The correct fact, written as a plain statement about the user. This is injected verbatim into daily briefings." },
    supersedes: { type: "string", required: false, description: "The wrong text, quoted from the harvest. Required in practice for amend and retract - it is how the briefing knows what to disregard." },
    rationale: { type: "string", required: false, description: "Why this correction was made, from the conversation" },
    fields: { type: "string", required: false, description: 'JSON object of row fields to merge, for entity (type, domain, summary, importance, status) or contact (name, relationship, priority, contextNotes) targets. Example: {"relationship":"girlfriend"}. The single-field parameters below are an easier way to say the same' },
    relationship: { type: "string", required: false, description: "Contact target: new relationship, e.g. landlord. Default: unchanged" },
    priority: { type: "string", required: false, description: "Contact target: new priority, e.g. critical | high | normal | low. Default: unchanged" },
    context_notes: { type: "string", required: false, description: "Contact target: new notes that help triage their mail. Default: unchanged" },
    name: { type: "string", required: false, description: "Contact target: new display name. Default: unchanged" },
    type: { type: "string", required: false, description: "Entity target: new type, e.g. person, organization. Default: unchanged" },
    domain: { type: "string", required: false, description: "Entity target: new domain or field. Default: unchanged" },
    summary: { type: "string", required: false, description: "Entity target: new one-line summary. Default: unchanged" },
    importance: { type: "string", required: false, description: "Entity target: new importance. Default: unchanged" },
    status: { type: "string", required: false, description: "Entity target: new status. Default: unchanged" },
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
          throw new Error(`fields must be a JSON object: ${errMessage(err)}`);
        }
      }
    }

    // The single-field parameters win over the same key inside the JSON, and share its validation:
    // a field the target kind cannot take is rejected by recordCorrection with the allowed list.
    const FIELD_PARAMS: [string, string][] = [
      ["name", "name"], ["relationship", "relationship"], ["priority", "priority"], ["context_notes", "contextNotes"],
      ["type", "type"], ["domain", "domain"], ["summary", "summary"], ["importance", "importance"], ["status", "status"],
    ];
    for (const [param, column] of FIELD_PARAMS) {
      const value = params[param];
      if (value === undefined || value === null || String(value).trim() === "") continue;
      fields = { ...(fields ?? {}), [column]: String(value).trim() };
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

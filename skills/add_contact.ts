import type { Skill } from "../src/skills/loader";
import { addContact } from "../src/context/corrections";

const skill: Skill = {
  name: "add_contact",
  description:
    "Add a sender to the contact directory (an email address the user gets mail from or writes to), or bring back one that was removed. " +
    "The row is locked against a re-seed and the addition is reversible with revert_context_revision. If the contact already exists, use revise_context to change it.",
  risk_level: "medium",
  parameters: {
    identifier: { type: "string", required: true, description: "The email address. Contacts are an email sender directory, so it must be one." },
    name: { type: "string", required: false, description: "The person's or organisation's name" },
    relationship: { type: "string", required: false, description: "How the user knows them, e.g. landlord, employer, bank" },
    priority: { type: "string", required: false, description: "critical | high | normal | low (default normal)" },
    context_notes: { type: "string", required: false, description: "Anything that helps triage their mail" },
    rationale: { type: "string", required: false, description: "Why it is added, from what the user said" },
  },
  execute: async (params, ctx) => {
    const result = await addContact({
      identifier: String(params.identifier ?? ""),
      name: params.name ? String(params.name) : null,
      relationship: params.relationship ? String(params.relationship) : null,
      priority: params.priority ? String(params.priority) : null,
      contextNotes: params.context_notes ? String(params.context_notes) : null,
      rationale: params.rationale ? String(params.rationale) : null,
      source: ctx.triggeredBy,
      conversationId: ctx.conversationId ?? null,
    });
    return `Correction ${result.id} recorded - ${result.applied}. Reversible with revert_context_revision.`;
  },
};

export default skill;

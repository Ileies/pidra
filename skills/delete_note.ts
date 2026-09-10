import type { Skill } from "../src/skills/loader";
import { softDeleteNote } from "../src/notes/store";

/**
 * A soft delete: the note leaves the briefing payload immediately, the previous state is kept in
 * `note_revisions`, and the dashboard offers an undo. That reversibility is why this can stay a
 * low-risk skill instead of queueing for confirmation.
 */
const skill: Skill = {
  name: "delete_note",
  description:
    "Delete a note from the briefing system notes store by ID. Reversible: the note is moved to the " +
    "dashboard's trash and can be restored with restore_note. Run list_notes first to get a real ID.",
  risk_level: "low",
  parameters: {
    note_id: { type: "string", required: true, description: "UUID of the note to delete" },
  },
  execute: async (params, ctx) => {
    const note = await softDeleteNote(String(params.note_id ?? ""), {
      by: ctx.actor,
      skillExecutionId: ctx.executionId,
      conversationId: ctx.conversationId,
    });
    return `Note ${note.id} deleted (reversible with restore_note)`;
  },
};

export default skill;

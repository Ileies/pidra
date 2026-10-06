import { provenanceOf, type Skill } from "../src/skills/loader";
import { getNote, softDeleteNote } from "../src/notes/store";

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
  touches: ["notes"],
  parameters: {
    note_id: { type: "string", required: true, description: "UUID of the note to delete" },
    must_contain: {
      type: "string",
      required: false,
      description: "Safety check: delete only if the note's content contains this text (case-insensitive), so a stale or wrong id cannot remove another note. Default: no check",
    },
  },
  execute: async (params, ctx) => {
    const noteId = String(params.note_id ?? "");
    const guard = String(params.must_contain ?? "").trim().toLowerCase();
    if (guard) {
      const current = await getNote(noteId);
      if (!current) throw new Error(`note ${noteId} not found`);
      if (!current.content.toLowerCase().includes(guard)) {
        throw new Error(`note ${noteId} does not contain "${params.must_contain}", so nothing was deleted. Run list_notes to find the right note`);
      }
    }
    const note = await softDeleteNote(noteId, provenanceOf(ctx));
    return `Note ${note.id} deleted (reversible with restore_note)`;
  },
};

export default skill;

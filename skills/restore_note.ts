import { provenanceOf, type Skill } from "../src/skills/loader";
import { restoreNote } from "../src/notes/store";

const skill: Skill = {
  name: "restore_note",
  description:
    "Restore a deleted note, undoing a delete_note. Use list_notes with include_deleted to find the ID.",
  risk_level: "low",
  touches: ["notes"],
  parameters: {
    note_id: { type: "string", required: true, description: "UUID of the deleted note to restore" },
  },
  execute: async (params, ctx) => {
    const note = await restoreNote(String(params.note_id ?? ""), provenanceOf(ctx));
    return `Note ${note.id} restored (scope: ${note.scope})`;
  },
};

export default skill;

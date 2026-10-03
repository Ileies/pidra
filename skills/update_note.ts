import { provenanceOf, type Skill } from "../src/skills/loader";
import { expiryInDays, getNote, updateNote, NOTE_SCOPES, type NoteWrite } from "../src/notes/store";

/**
 * Notes are the mutable working layer, so this is a real in-place edit - unlike the harvested
 * long-term context, which is only ever corrected through `revise_context`. The pre-edit state is
 * appended to `note_revisions`, so the change stays reversible from the dashboard.
 */
const skill: Skill = {
  name: "update_note",
  description:
    "Edit an existing note: its content, its scope, or its expiry. Run list_notes first so note_id is real. " +
    "The previous version is kept in the note's history, so the edit is reversible. " +
    "This is for notes only - facts the Context Builder harvested are corrected with revise_context instead.",
  risk_level: "low",
  parameters: {
    note_id: { type: "string", required: true, description: "UUID of the note to edit" },
    content: { type: "string", required: false, description: "New content, replacing the old text in full. Default: content unchanged" },
    append: { type: "string", required: false, description: "Text added on a new line after the existing content, instead of rewriting it. Cannot be combined with content. Default: nothing appended" },
    scope: { type: "string", required: false, description: `New scope, one of: ${NOTE_SCOPES.join(" | ")}. Default: scope unchanged` },
    expires_at: { type: "string", required: false, description: "New expiry as YYYY-MM-DD, or 'none' to clear it. Default: expiry unchanged" },
    expires_in_days: { type: "number", required: false, description: "New expiry this many days from today, 1 to 3650. Ignored when expires_at is given. Default: expiry unchanged" },
  },
  execute: async (params, ctx) => {
    const noteId = String(params.note_id ?? "");
    const patch: NoteWrite = {};

    if (params.content !== undefined && params.append !== undefined) {
      throw new Error("give either content (replace) or append (add to the end), not both");
    }
    if (params.content !== undefined) patch.content = String(params.content);
    if (params.append !== undefined) {
      const addition = String(params.append).trim();
      if (!addition) throw new Error("append is empty");
      const current = await getNote(noteId);
      if (!current) throw new Error(`note ${noteId} not found`);
      patch.content = `${current.content.trimEnd()}\n${addition}`;
    }
    if (params.scope !== undefined) patch.scope = String(params.scope);
    if (params.expires_at !== undefined) {
      const raw = String(params.expires_at).trim().toLowerCase();
      patch.expiresAt = raw === "none" || raw === "null" || raw === "" ? null : String(params.expires_at).trim();
    } else if (params.expires_in_days !== undefined && params.expires_in_days !== null && params.expires_in_days !== "") {
      patch.expiresAt = expiryInDays(params.expires_in_days);
    }

    const note = await updateNote(noteId, patch, provenanceOf(ctx));

    return `Note ${note.id} updated (scope: ${note.scope}). The previous version is in the note's history.`;
  },
};

export default skill;

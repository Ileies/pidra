import type { Skill } from "../src/skills/loader";
import { updateNote, NOTE_SCOPES, type NoteWrite } from "../src/notes/store";

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
    content: { type: "string", required: false, description: "New content, replacing the old text in full" },
    scope: { type: "string", required: false, description: `New scope, one of: ${NOTE_SCOPES.join(" | ")}` },
    expires_at: { type: "string", required: false, description: "New expiry as YYYY-MM-DD, or 'none' to clear it" },
  },
  execute: async (params, ctx) => {
    const patch: NoteWrite = {};
    if (params.content !== undefined) patch.content = String(params.content);
    if (params.scope !== undefined) patch.scope = String(params.scope);
    if (params.expires_at !== undefined) {
      const raw = String(params.expires_at).trim().toLowerCase();
      patch.expiresAt = raw === "none" || raw === "null" || raw === "" ? null : String(params.expires_at).trim();
    }

    const note = await updateNote(String(params.note_id ?? ""), patch, {
      by: ctx.actor,
      skillExecutionId: ctx.executionId,
      conversationId: ctx.conversationId,
    });

    return `Note ${note.id} updated (scope: ${note.scope}). The previous version is in the note's history.`;
  },
};

export default skill;

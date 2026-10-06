import { provenanceOf, type Skill } from "../src/skills/loader";
import { createNote, expiryInDays, NOTE_SCOPES } from "../src/notes/store";

const skill: Skill = {
  name: "write_note",
  description:
    "Write a note to the briefing system notes store. Notes are standing instructions and context " +
    "for the daily briefing: 'intel' and 'global' notes steer Section 1, 'personal' and 'global' steer Section 2.",
  risk_level: "low",
  touches: ["notes"],
  parameters: {
    content: { type: "string", required: true, description: "Note content" },
    scope: { type: "string", required: false, description: `One of: ${NOTE_SCOPES.join(" | ")} (default: global)` },
    expires_at: { type: "string", required: false, description: "Optional expiry date as YYYY-MM-DD. Default: the note never expires" },
    expires_in_days: { type: "number", required: false, description: "Expire this many days from today, 1 to 3650, instead of giving a date. Ignored when expires_at is given. Default: never" },
  },
  execute: async (params, ctx) => {
    const expiresAt = params.expires_at
      ? String(params.expires_at)
      : params.expires_in_days !== undefined && params.expires_in_days !== null && params.expires_in_days !== ""
        ? expiryInDays(params.expires_in_days)
        : null;

    const note = await createNote(
      {
        content: String(params.content ?? ""),
        scope: params.scope ? String(params.scope) : undefined,
        expiresAt,
      },
      provenanceOf(ctx),
    );
    return `Note created with id=${note.id} (scope: ${note.scope}${note.expiresAt ? `, expires ${note.expiresAt}` : ""})`;
  },
};

export default skill;

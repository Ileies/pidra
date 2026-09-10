import type { Skill } from "../src/skills/loader";
import { createNote, NOTE_SCOPES } from "../src/notes/store";

const skill: Skill = {
  name: "write_note",
  description:
    "Write a note to the briefing system notes store. Notes are standing instructions and context " +
    "for the daily briefing: 'intel' and 'global' notes steer Section 1, 'personal' and 'global' steer Section 2.",
  risk_level: "low",
  parameters: {
    content: { type: "string", required: true, description: "Note content" },
    scope: { type: "string", required: false, description: `One of: ${NOTE_SCOPES.join(" | ")} (default: global)` },
    expires_at: { type: "string", required: false, description: "Optional expiry date as YYYY-MM-DD" },
  },
  execute: async (params, ctx) => {
    const note = await createNote(
      {
        content: String(params.content ?? ""),
        scope: params.scope ? String(params.scope) : undefined,
        expiresAt: params.expires_at ? String(params.expires_at) : null,
      },
      { by: ctx.actor, skillExecutionId: ctx.executionId, conversationId: ctx.conversationId },
    );
    return `Note created with id=${note.id} (scope: ${note.scope})`;
  },
};

export default skill;

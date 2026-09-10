import type { Skill } from "../src/skills/loader";
import { listNotes, formatNoteLine, NOTE_SCOPES } from "../src/notes/store";

/**
 * The assistant needs real note ids before it can edit or delete anything, and it must not guess
 * them. Read this before every `update_note` or `delete_note`.
 */
const skill: Skill = {
  name: "list_notes",
  description:
    "List notes from the briefing system notes store, with their IDs. Use this before update_note or " +
    "delete_note so the ID is real. Optional filters: scope, and a substring search on content.",
  risk_level: "low",
  parameters: {
    scope: { type: "string", required: false, description: `Restrict to one of: ${NOTE_SCOPES.join(" | ")}` },
    query: { type: "string", required: false, description: "Substring to search for in the note content" },
    include_deleted: { type: "boolean", required: false, description: "Also list notes in the trash (default: false)" },
    limit: { type: "number", required: false, description: "How many notes to return (default 50, max 200)" },
  },
  execute: async (params) => {
    const limit = Math.min(Math.max(Number(params.limit ?? 50) || 50, 1), 200);
    const notes = await listNotes({
      scope: params.scope ? String(params.scope) : undefined,
      query: params.query ? String(params.query) : undefined,
      include: params.include_deleted ? "all" : "active",
      limit,
    });

    if (notes.length === 0) return "No notes match.";
    return `${notes.length} note(s):\n\n${notes.map(formatNoteLine).join("\n\n")}`;
  },
};

export default skill;

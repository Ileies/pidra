import type { Skill } from "../src/skills/loader";
import { db, notes } from "../src/db";

const skill: Skill = {
  name: "write_note",
  description: "Write a note to the briefing system notes store",
  risk_level: "low",
  parameters: {
    content: { type: "string", required: true, description: "Note content" },
    scope: { type: "string", required: false, description: "global | intel | personal | contact | search (default: global)" },
  },
  execute: async (params) => {
    const content = String(params.content ?? "").trim();
    if (!content) throw new Error("content is required");
    const scope = String(params.scope ?? "global");
    const validScopes = ["global", "intel", "personal", "contact", "search"];
    const [row] = await db.insert(notes).values({
      content,
      scope: validScopes.includes(scope) ? scope : "global",
      createdBy: "system",
    }).returning({ id: notes.id });
    return `Note created with id=${row.id}`;
  },
};

export default skill;

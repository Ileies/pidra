import type { Skill } from "../src/skills/loader";
import { db, notes } from "../src/db";
import { eq } from "drizzle-orm";

const skill: Skill = {
  name: "delete_note",
  description: "Delete a note from the briefing system notes store by ID",
  risk_level: "low",
  parameters: {
    note_id: { type: "string", required: true, description: "UUID of the note to delete" },
  },
  execute: async (params) => {
    const id = String(params.note_id ?? "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid note_id");
    const deleted = await db.delete(notes).where(eq(notes.id, id)).returning({ id: notes.id });
    if (deleted.length === 0) throw new Error(`Note ${id} not found`);
    return `Note ${id} deleted`;
  },
};

export default skill;

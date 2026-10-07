import type { Skill } from "../src/skills/loader";
import { listNotes, formatNoteLine, NOTE_AUTHORS, NOTE_SCOPES, NOTE_SORTS } from "../src/notes/store";
import { loadStatsFor } from "../src/notes/loads";
import { DORMANT_DAYS, NARROWNESS } from "../src/notes/narrowness";
import { NOTE_STEPS } from "../src/notes/select";

/**
 * The assistant needs real note ids before it can edit or delete anything, and it must not guess
 * them. Read this before every `update_note` or `delete_note`.
 */
const skill: Skill = {
  name: "list_notes",
  description:
    "List notes from the briefing system notes store, with their IDs. Use this before update_note or " +
    "delete_note so the ID is real. Optional filters: scope, a substring search on content, who wrote it, " +
    "when it was created, which expire soon, how narrow it is, which step can read it, who it targets, and which have not loaded lately. " +
    "Each line says how often the note went into a model call. Newest first by default.",
  risk_level: "low",
  touches: [],
  parameters: {
    scope: { type: "string", required: false, description: `Restrict to one of: ${NOTE_SCOPES.join(" | ")}. Default: all scopes` },
    query: { type: "string", required: false, description: "Substring to search for in the note content" },
    include_deleted: { type: "boolean", required: false, description: "Also list notes in the trash (default: false)" },
    only_deleted: { type: "boolean", required: false, description: "List only notes in the trash, to find one to restore (default: false)" },
    created_by: { type: "string", required: false, description: `Only notes first written by: ${NOTE_AUTHORS.join(" | ")}. Default: anyone` },
    created_since: { type: "string", required: false, description: "Only notes created on or after this day, YYYY-MM-DD. Default: no limit" },
    expires_before: { type: "string", required: false, description: "Only notes that expire on or before this day, YYYY-MM-DD. Notes without an expiry are left out. Default: no filter" },
    narrowness: { type: "string", required: false, description: `Only notes that are: ${NARROWNESS.join(" | ")} (always = no steps and no targets, step = steps only, targeted = names a sender, entity or keyword, dated = has a start or expiry day). Default: any` },
    step: { type: "string", required: false, description: `Only notes the step can read, by scope and steps: ${NOTE_STEPS.join(" | ")}. Default: any` },
    target: { type: "string", required: false, description: "Only notes whose targeting names this sender, entity or keyword (substring). Default: any" },
    not_loaded: { type: "boolean", required: false, description: `Only notes that went into no model call in the last ${DORMANT_DAYS} days, to find ones too narrow to ever fire (default: false)` },
    sort: { type: "string", required: false, description: `Order: ${NOTE_SORTS.join(" | ")} (edited = last changed first). Default: newest` },
    limit: { type: "number", required: false, description: "How many notes to return (default 50, max 200)" },
  },
  execute: async (params) => {
    const limit = Math.min(Math.max(Math.trunc(Number(params.limit ?? 50)) || 50, 1), 200);

    const sort = params.sort ? String(params.sort).trim().toLowerCase() : undefined;
    if (sort && !NOTE_SORTS.includes(sort as (typeof NOTE_SORTS)[number])) {
      throw new Error(`sort must be one of ${NOTE_SORTS.join(", ")}`);
    }

    const notes = await listNotes({
      scope: params.scope ? String(params.scope) : undefined,
      query: params.query ? String(params.query) : undefined,
      include: params.only_deleted ? "deleted" : params.include_deleted ? "all" : "active",
      createdBy: params.created_by ? String(params.created_by).trim().toLowerCase() : undefined,
      createdSince: params.created_since ? String(params.created_since).trim() : undefined,
      expiresBefore: params.expires_before ? String(params.expires_before).trim() : undefined,
      narrowness: params.narrowness ? String(params.narrowness) : undefined,
      step: params.step ? String(params.step) : undefined,
      target: params.target ? String(params.target) : undefined,
      dormant: params.not_loaded === true || params.not_loaded === "true",
      sort: sort as (typeof NOTE_SORTS)[number] | undefined,
      limit,
    });

    if (notes.length === 0) return "No notes match.";
    const more = notes.length === limit ? `\n\n(showing the first ${limit}; narrow the filters or raise limit for more)` : "";
    const stats = await loadStatsFor(notes.map((n) => n.id));
    const loaded = (id: string) => {
      const s = stats.get(id);
      return s ? `\n  loaded ${s.count}x, last ${s.last}` : "\n  no load recorded";
    };
    return `${notes.length} note(s):\n\n${notes.map((n) => formatNoteLine(n) + loaded(n.id)).join("\n\n")}${more}`;
  },
};

export default skill;

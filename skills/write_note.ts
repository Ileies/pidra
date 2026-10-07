import { provenanceOf, type Skill } from "../src/skills/loader";
import { createNote, expiryInDays, NOTE_SCOPES } from "../src/notes/store";
import { listFromText, targetsFromParams } from "../src/notes/targeting";
import { NOTE_STEPS } from "../src/notes/select";

const skill: Skill = {
  name: "write_note",
  description:
    "Write a note to the briefing system notes store. Notes are standing instructions and context " +
    "for the daily briefing: 'intel' and 'global' notes steer Section 1, 'personal' and 'global' steer Section 2. " +
    "Make a note as narrow as it really is, because every note that loads costs tokens and clutters the stage it loads in. " +
    "A fact about one sender or company ('Netcup payments are automated') belongs to the classify step and that sender: " +
    "steps=classify, senders=netcup. A rule about how a report is written belongs to the section that writes it. " +
    "Leave steps and the targeting empty only for a rule that holds for everything. " +
    "Say in your reply which steps and targets you chose, so the user can correct them.",
  risk_level: "low",
  touches: ["notes"],
  parameters: {
    content: { type: "string", required: true, description: "Note content" },
    scope: { type: "string", required: false, description: `One of: ${NOTE_SCOPES.join(" | ")} (default: global)` },
    expires_at: { type: "string", required: false, description: "Optional expiry date as YYYY-MM-DD. Default: the note never expires" },
    expires_in_days: { type: "number", required: false, description: "Expire this many days from today, 1 to 3650, instead of giving a date. Ignored when expires_at is given. Default: never" },
    active_from: { type: "string", required: false, description: "First day the note applies, YYYY-MM-DD, for something that starts later. Default: at once" },
    steps: { type: "string", required: false, description: `Comma-separated pipeline steps that load the note, from: ${NOTE_STEPS.join(", ")}. Default: every step the scope reaches` },
    senders: { type: "string", required: false, description: "Comma-separated sender names, addresses, domains or phone numbers (substring match, any one is enough). The note then loads only for items from a matching sender. Default: any sender" },
    entities: { type: "string", required: false, description: "Comma-separated entity names (substring match against the item text and its entities, any one is enough). Default: any" },
    keywords: { type: "string", required: false, description: "Comma-separated words that must appear in the item text (any one is enough). Combined with senders and entities by AND. Default: any" },
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
        activeFrom: params.active_from ? String(params.active_from) : null,
        steps: listFromText(params.steps),
        appliesTo: targetsFromParams(params) ?? null,
      },
      provenanceOf(ctx),
    );
    const targets = Object.entries(note.appliesTo ?? {}).map(([k, v]) => `${k}: ${(v as string[]).join(", ")}`);
    return (
      `Note created with id=${note.id} (scope: ${note.scope}` +
      `${note.activeFrom ? `, from ${note.activeFrom}` : ""}${note.expiresAt ? `, expires ${note.expiresAt}` : ""}; ` +
      `steps: ${note.steps.length > 0 ? note.steps.join(", ") : "all"}; ` +
      `only for: ${targets.length > 0 ? targets.join("; ") : "everything"})`
    );
  },
};

export default skill;

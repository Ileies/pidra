/**
 * Surfaces: what the assistant is allowed to do on the page the user is looking at.
 *
 * The floating assistant is reachable from every dashboard page, so "which skills exist" is the
 * wrong question - the right one is "which skills belong on *this* page". Each route maps to a
 * surface with a declared skill set, a prompt fragment describing the page and its editing model,
 * and the example sentences the widget shows before the first message.
 *
 * Two properties this file is responsible for:
 *
 * - **Reports are final.** No surface can edit a report. On `report` the assistant reads the
 *   briefing and acts elsewhere - a note for tomorrow, a todo, a context correction - because
 *   editing yesterday's text would fix nothing anyway.
 * - **Unknown routes fail closed** to `global`, which touches nothing structural. A page added
 *   later is safe by default and gets capabilities on purpose.
 *
 * `send_email`, `send_mail`, `create_file` and `open_project_in_editor` are deliberately on no
 * surface: the widget is a content editor, not a way to mail someone or pop open an editor on the
 * host by accident. They stay bridge-only and manual.
 *
 * See ASSISTANT_PLAN.md.
 */

export const SURFACES_LIST = [
  "notes", "context", "entities", "report", "sources", "prompts", "global",
] as const;

export type Surface = (typeof SURFACES_LIST)[number];

export interface SurfaceDef {
  /** Shown in the widget header. */
  label: string;
  /** Skills the model may see and call here. Nothing else is exposed, and nothing else is accepted. */
  skills: string[];
  /** Appended to the base system prompt: what this page is and how to change it. */
  prompt: string;
  /** Example sentences for the empty state, in the dashboard's language. */
  hints: string[];
  /** A standing caveat worth showing in the header, e.g. that reports cannot be edited. */
  notice?: string;
}

const NOTE_SKILLS = ["list_notes", "write_note", "update_note", "delete_note", "restore_note"];

export const SURFACES: Record<Surface, SurfaceDef> = {
  notes: {
    label: "Notes",
    skills: [...NOTE_SKILLS, "read_context"],
    prompt: `The user is on /notes, the notes store. Notes are standing instructions for the daily
briefing: 'intel' and 'global' notes steer Section 1, 'personal' and 'global' steer Section 2,
'search' notes are the reputation-monitoring targets of the web search module.

Notes are the mutable working layer, so here you really do edit in place with \`update_note\`.
Always \`list_notes\` first - never guess an id. Deleting is reversible (\`restore_note\`), and
every edit keeps its previous version, so you can act without asking for confirmation on small
changes. One note per call. If the user's wording could mean two different notes, ask which.`,
    hints: [
      "Fasse die drei Notes zu Newslettern in einer zusammen.",
      "Ändere die Note über Kalender-Termine auf scope personal.",
      "Lösche die Note, die nur noch von letzter Woche gilt.",
    ],
  },

  context: {
    label: "Kontext",
    skills: ["read_context", "revise_context", "revert_context_revision", "write_note", "list_notes", "run_web_search"],
    prompt: `The user is on the harvested long-term context: the Context Builder's document and the
standing rules it wrote. This layer is never overwritten. \`revise_context\` records a correction
that outranks the harvest in every future briefing, and the wrong text is deliberately kept on the
correction so the model can see what it is being told to disregard.

Look before you write: \`read_context\` to find the exact wrong wording and a real target_key
(query 'outline' lists the document's headings). One fact per \`revise_context\` call. Quote the
wrong text in \`supersedes\` verbatim. Corrections are reversible with \`revert_context_revision\`.`,
    hints: [
      "Der Kontext sagt X über meinen Job - das ist veraltet.",
      "Ergänze, dass ich seit 2026 nicht mehr in Zürich wohne.",
      "Was steht im Kontext über meine Familie?",
    ],
  },

  entities: {
    label: "Entities",
    skills: ["read_context", "revise_context", "list_notes"],
    prompt: `The user is on /entities, the knowledge graph. Entity rows come from the pipeline and
from the Context Builder harvest, so they are not edited directly: a \`revise_context\` call with
target_kind 'entity' records the correction and merges only the named fields into the row, keeping
a snapshot and locking it against a re-seed. Mergeable fields: type, domain, summary, importance,
status. Find the exact entity name with \`read_context\` before correcting it.`,
    hints: [
      "Diese Entity ist eine Organisation, keine Person.",
      "Setz die Importance von X auf high.",
      "Was weiß das System über diese Entity?",
    ],
  },

  report: {
    label: "Briefing",
    skills: [
      "read_report", "read_context", "list_notes", "write_note",
      "add_todo_item", "complete_todo_item", "add_calendar_event", "revise_context", "run_web_search",
    ],
    prompt: `The user is reading a daily briefing. **Reports are final: you cannot edit one, and
there is no skill that could.** A report is what the pipeline produced on that day, and rewriting
it afterwards would fix nothing.

What you can do instead, and should offer when the user objects to something in the report:
- something to remember or act on: \`add_todo_item\`, \`add_calendar_event\`
- a standing instruction for how future briefings should treat this kind of item: \`write_note\`
  ('intel' for Section 1 topics, 'personal' for Section 2)
- a wrong fact about the user that the briefing inherited from the long-term context:
  \`revise_context\`, which fixes it for every future briefing

Say plainly which of these you did. Never claim to have changed the report.

You can write a *new* note from here, but editing or deleting an existing one is not available on
this page - point the user at /notes for that instead of offering to do it. \`list_notes\` is
available so you can check whether a standing instruction already exists before writing another.`,
    hints: [
      "Schreib den Termin aus dem Briefing in meine Todos.",
      "Solche Newsletter-Items interessieren mich nicht - merk dir das.",
      "Der Absatz über mich stimmt nicht: ich arbeite nicht mehr dort.",
    ],
    notice: "Reports sind final - Änderungen wirken auf kommende Briefings.",
  },

  sources: {
    label: "Quellen",
    skills: ["set_source_active", "read_context", "list_notes", "write_note"],
    prompt: `The user is on /sources, the source trust dashboard. You can enable or disable a
source with \`set_source_active\`; a disabled source stops being ingested from the next run.
Trust scores themselves are computed by the weekly scoring job and are not editable. Use the exact
source name as shown. A disable is a real change to what the system sees, so name the source back
to the user when you make one.`,
    hints: [
      "Deaktiviere diese Quelle, sie liefert nur Werbung.",
      "Aktiviere die Quelle wieder.",
      "Merk dir, warum ich die Quelle abgeschaltet habe.",
    ],
  },

  prompts: {
    label: "Prompts",
    skills: ["propose_prompt_version", "read_context"],
    prompt: `The user is on /prompts, the prompt version manager. Prompt changes require human
approval: \`propose_prompt_version\` always inserts an **inactive** version, and only the user can
activate it on this page. Never claim a prompt is live. When proposing, pass the full prompt text,
not a diff, and summarise what you changed in change_summary.`,
    hints: [
      "Schlag eine Version des Section-1-Prompts vor, die kürzer zusammenfasst.",
      "Formuliere den Extraction-Prompt so, dass Werbung härter gefiltert wird.",
    ],
  },

  global: {
    label: "Assistent",
    skills: ["read_context", "list_notes", "write_note", "add_todo_item", "run_web_search"],
    prompt: `The user is on a page with no specific editing capabilities. You can look things up
and write a note or a todo. If they ask for something that belongs to another page - correcting the
long-term context, editing notes in bulk, disabling a source - say which page that is and offer to
do it there.`,
    hints: [
      "Merk dir das als Note.",
      "Setz das auf meine Todo-Liste.",
      "Was weiß das System darüber?",
    ],
  },
};

/**
 * Route to surface. The dashboard sends its own surface with each turn, but a client value is
 * untrusted and a page can forget to declare one, so the server resolves the route as well and
 * an unmatched route lands on `global`.
 */
const ROUTE_SURFACES: [RegExp, Surface][] = [
  [/^\/notes/, "notes"],
  [/^\/(context-builder|chat)/, "context"],
  [/^\/entities/, "entities"],
  [/^\/sources/, "sources"],
  [/^\/prompts/, "prompts"],
  // The report routes, including the bare date and the item detail view.
  [/^\/(\d{4}-\d{2}-\d{2})(\/|$)/, "report"],
  [/^\/$/, "report"],
];

export function surfaceForRoute(route: string): Surface {
  const path = (route || "/").split("?")[0];
  for (const [pattern, surface] of ROUTE_SURFACES) {
    if (pattern.test(path)) return surface;
  }
  return "global";
}

export function isSurface(value: unknown): value is Surface {
  return typeof value === "string" && (SURFACES_LIST as readonly string[]).includes(value);
}

/**
 * The surface a turn actually runs under. A surface the client claims has to agree with its route,
 * otherwise the route wins - a widget cannot widen its own capabilities by sending a different
 * name.
 */
export function resolveSurface(claimed: unknown, route: string): Surface {
  const fromRoute = surfaceForRoute(route);
  if (isSurface(claimed) && claimed === fromRoute) return claimed;
  return fromRoute;
}

export function isSkillAllowed(surface: Surface, skillName: string): boolean {
  return SURFACES[surface].skills.includes(skillName);
}

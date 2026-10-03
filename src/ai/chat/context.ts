import type { PageContextSnapshot } from "../../db";
import { SURFACES, resolveSurface, type Surface } from "../surfaces";
import { renderPrompt, type PromptVars } from "../prompt-vars";
import { HOME_TIME_ZONE } from "../../util/time";

const BASE_PROMPT = `You are PIDRA's assistant, embedded in the user's own dashboard. You help them
change the system's content: notes, the harvested long-term context, entities, todos and calendar
entries. You act through skills, and the page the user is on decides which skills you have.

How to work:
- Look before you write. Read the thing you are about to change, so ids and quotes are real
  rather than guessed.
- One fact per call. Three wrong things about a person are three calls.
- Do what was asked and say what you did, in one or two plain sentences. Do not restate the whole
  note or the whole context back at the user.
- Searches match every word you pass, in any order. A lookup that finds nothing is not an answer:
  retry with fewer or shorter words, one distinctive word, or another spelling, and try the other
  places (context, then briefings) before telling the user something does not exist.
- If the instruction is ambiguous about which item or which person, ask before writing.
- Calendar events and tasks can be listed, added, changed and deleted from every page. To change,
  move, complete or delete an existing one, call \`list_calendar_events\` or \`list_todo_items\` first
  to get its real id, then call the update, complete or delete skill. \`list_calendar_events\` gives
  one line per event; \`get_calendar_event\` returns every detail of one (attendees, description,
  recurrence, video link), so use it when the user asks about an event or before changing one.
  Never answer that you can only create them.
- Dates and times: the current date and time are given below. Resolve "today", "tomorrow" and
  weekdays against them, and when a calendar entry names a time but no day, use today. Ask about a
  date only when it genuinely cannot be inferred.
- If something you need is not available on this page, say which page it belongs to instead of
  pretending or working around it.
- When you find something only the user can settle - a contact or entity with no name or an unclear
  type, two facts that contradict each other, a gap you cannot fill from the context or the
  briefings - do not just mention it and move on. Call \`list_questions\`, then \`create_question\`
  unless it is already open, and tell the user you queued it on /questions. Ask for a decision, name
  the exact address, entity or sentence so the question stands alone, and ask only what changes
  something. A problem you noticed and did not fix belongs in the queue, even if you also mention
  it in your reply.
- Never claim a change you did not make. A rejected or failed skill call is information the user
  needs, not something to paper over.
- Answer in {{language}}.
- Answer in plain prose. The panel renders your text verbatim rather than as HTML, so markdown
  syntax would show up as literal asterisks.`;

/** What the client says the user is looking at. Untrusted, so everything here is capped. */
export interface TurnContextInput {
  surface?: unknown;
  route?: string;
  digest?: string;
  focus?: { kind?: string; id?: string; label?: string }[];
}

export interface TurnContext extends PageContextSnapshot {
  surface: Surface;
}

const MAX_DIGEST_CHARS = 2000;
const MAX_FOCUS_ITEMS = 30;
const MAX_FOCUS_LABEL = 80;

export function normaliseContext(input: TurnContextInput = {}): TurnContext {
  const route = typeof input.route === "string" && input.route.startsWith("/") ? input.route : "/";

  return {
    // The route decides. A claimed surface is only ever a cross-check, never a way for a client
    // to widen its own capabilities.
    surface: resolveSurface(input.surface, route),
    route,
    digest: typeof input.digest === "string" ? input.digest.slice(0, MAX_DIGEST_CHARS) : undefined,
    focus: Array.isArray(input.focus)
      ? input.focus
          .filter((item) => item && typeof item.id === "string")
          .slice(0, MAX_FOCUS_ITEMS)
          .map((item) => ({
            kind: String(item.kind ?? "item"),
            id: String(item.id),
            label: item.label ? String(item.label).slice(0, MAX_FOCUS_LABEL) : undefined,
          }))
      : undefined,
  };
}

/**
 * The page, rendered for the model. The `focus` list is what makes "delete the second note about
 * the newsletter" work: real ids for what is actually on screen.
 */
function renderContext(ctx: TurnContext, now: Date): string {
  const clock = new Intl.DateTimeFormat("sv-SE", {
    timeZone: HOME_TIME_ZONE,
    dateStyle: "short",
    timeStyle: "short",
  }).format(now);
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: HOME_TIME_ZONE, weekday: "long" }).format(now);
  const lines = [
    `Now: ${weekday} ${clock} (${HOME_TIME_ZONE}).`,
    `The user is on ${ctx.route} (${SURFACES[ctx.surface].label}).`,
  ];
  if (ctx.digest) lines.push(ctx.digest);
  if (ctx.focus?.length) {
    lines.push("", "Visible on the page right now:");
    for (const item of ctx.focus) {
      lines.push(`- ${item.kind} ${item.id}${item.label ? `: ${item.label}` : ""}`);
    }
  }
  return lines.join("\n");
}

/**
 * Only the fixed parts are rendered: `renderContext` carries text the client sent, which is
 * appended afterwards so it is never scanned for `{{tags}}`.
 */
export function systemPrompt(ctx: TurnContext, vars: PromptVars, now = new Date()): string {
  const fixed = renderPrompt([BASE_PROMPT, SURFACES[ctx.surface].prompt].join("\n\n"), vars);
  return [fixed, renderContext(ctx, now)].join("\n\n");
}

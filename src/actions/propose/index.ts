/**
 * Quick actions: the one-tap buttons the report offers beside a personal item.
 *
 * A separate model call, not a field of the Section 2 synthesis. Section 2 is asked to write,
 * and a writer handed a "suggestions" field fills it; this call is asked one narrower question,
 * whether a mail is worth a button, and is told that the normal answer is no. Its prompt is the
 * `quick_actions` section (`QUICK_ACTIONS_PROMPT`), overridable by an active prompt version like any other.
 *
 * The model proposes, code decides, the same split as the news desks:
 * - It sees short ids ("m1", "c3", "t12"), never a UUID or a Google id, and code maps them back.
 *   An id that maps to nothing discards the action rather than guessing.
 * - Every date is parsed as a wall-clock time in the primary calendar's zone (`calendarTimeZone`)
 *   and turned into an instant here, so a server running in UTC cannot move an appointment by
 *   hours. The unattended run has no browser to ask.
 * - An event is checked against the calendar on its own day, not only against the seven days
 *   Phase 1 ingests, and a task against the whole open list rather than the 40 Section 2 gets.
 * - Hard caps: two per mail, `MAX_ACTIONS` per day.
 * What code throws out is still written, as `discarded` with the reason (`store.ts`), so tuning
 * the prompt can start from the table.
 *
 * What it reads: the day's personal mail and SMS that passed the gate, plus automated mail the gate
 * dropped as low urgency when the classifier flagged a calendar event or a to-do in it - a booking
 * confirmation is automated mail, and it is the case this feature exists for. It reads the mail text
 * itself, since the classification carries no times or places, and answers in strict JSON only,
 * which makes it an extraction-shaped call: no prose from it ever reaches the report.
 *
 * Layout: `types` (shapes and the model's schema), `mails` (what it reads), `matching` (time and
 * similarity helpers), `check` (validates one action), this file (the call and the caps).
 */
import { activePrompt } from "../../ai/active-prompts";
import { extractJson, usageTally } from "../../ai/openai";
import { calendarTimeZone } from "../../ingest/google";
import { localDay } from "../../util/time";
import { check, clean, rawPreview, type Checked, type Refs } from "./check";
import { candidateMails, openTodos, type Mail } from "./mails";
import { eventDays, sameThing, wallClock, weekday } from "./matching";
import {
  ACTIONS_SCHEMA, SKILL_FOR,
  type ActionInputs, type DiscardReason, type ModelAction, type Proposal, type QuickActionsResult,
} from "./types";

export { sameThing };
export * from "./types";

const MAX_ACTIONS = 6;
const MAX_PER_MAIL = 2;

function buildPayload(ctx: ActionInputs, runDate: string, zone: string, mails: Mail[], refs: Pick<Refs, "events" | "tasks">) {
  return {
    today: `${runDate} (${weekday(runDate)})`,
    time_zone: zone,
    mails: mails.map((mail) => ({
      id: mail.shortId,
      kind: mail.sourceType === "sms" ? "sms" : "email",
      received: mail.receivedAt ? `${wallClock(mail.receivedAt, zone).replace("T", " ")} (${weekday(localDay(mail.receivedAt, zone))})` : null,
      classification: mail.classification,
      text: mail.text,
    })),
    calendar: [...refs.events].map(([id, event]) => ({
      id,
      title: event.title,
      start: event.is_all_day ? event.start : wallClock(event.start, zone),
      end: event.is_all_day ? eventDays(event, zone)[1] : wallClock(event.end || event.start, zone),
      all_day: event.is_all_day,
      location: event.location,
    })),
    todos: [...refs.tasks].map(([id, task]) => ({ id, title: task.title, due: task.due, list: task.list_name })),
    // Personal scope only: global notes carry the weekly meta-run's prompt proposals, which are
    // not instructions about the reader's mail.
    instructions: ctx.notesPersonal.filter((note) => note.scope === "personal").map((note) => note.content),
  };
}

/** Checks each model action and applies the duplicate, per-mail and daily caps. Discarded ones are kept, with the reason. */
async function decide(actions: ModelAction[], refs: Refs): Promise<{ proposals: Proposal[]; offered: number }> {
  const proposals: Proposal[] = [];
  const perMail = new Map<string, number>();
  let offered = 0;

  for (const action of actions) {
    const sources = [...new Set(action.mail_ids.map((id) => id.trim()))].filter((id) => refs.mails.has(id));
    const sourceExtractionIds = sources.flatMap((id) => refs.mails.get(id)!.extractionIds);
    const base = { kind: action.kind, skillName: SKILL_FOR[action.kind], reason: clean(action.why, 200), sourceExtractionIds };

    const checked: Checked = sources.length === 0
      ? { ok: false, reason: "unknown_mail", preview: rawPreview(action) }
      : await check(action, refs);

    if (!checked.ok) {
      proposals.push({ ...base, parameters: { ...action }, preview: checked.preview, discarded: checked.reason });
      continue;
    }

    const proposal: Proposal = { ...base, parameters: checked.parameters, preview: checked.preview, discarded: null };
    const discarded: DiscardReason | null =
      proposals.some((p) => p.discarded === null && sameThing(p, proposal)) ? "duplicate"
      : sources.some((id) => (perMail.get(id) ?? 0) >= MAX_PER_MAIL) ? "per_mail_cap"
      : offered >= MAX_ACTIONS ? "daily_cap"
      : null;

    if (discarded === null) {
      offered++;
      for (const id of sources) perMail.set(id, (perMail.get(id) ?? 0) + 1);
    }
    proposals.push({ ...proposal, discarded });
  }
  return { proposals, offered };
}

/** The proposals for a run, offered and discarded alike. Makes no call on a day without candidates. */
export async function proposeQuickActions(ctx: ActionInputs, runDate: string): Promise<QuickActionsResult> {
  const mails = await candidateMails(runDate);
  if (mails.length === 0) {
    console.log("[Actions] No personal mail to act on");
    return { proposals: [], tokensIn: 0, tokensOut: 0, aiCalls: 0 };
  }

  const [openTasks, zone] = await Promise.all([openTodos(runDate), calendarTimeZone()]);
  const events = new Map(ctx.calendarItems.map((event, i) => [`c${i + 1}`, event]));
  const tasks = new Map(openTasks.map((task, i) => [`t${i + 1}`, task]));

  const prompt = await activePrompt("quick_actions");
  const usage = usageTally();
  const answer = await extractJson<{ actions: ModelAction[] }>(
    prompt.text,
    JSON.stringify(buildPayload(ctx, runDate, zone, mails, { events, tasks })),
    {
      schema: ACTIONS_SCHEMA,
      // Judgement is the whole job here, and a wrong "yes" is the failure that matters.
      reasoningEffort: "high",
      maxOutputTokens: 12000,
      onUsage: usage.onUsage,
    },
  );

  const { proposals, offered } = await decide(answer.actions, {
    mails: new Map(mails.map((mail) => [mail.shortId, mail])),
    events,
    tasks,
    ingestedCalendar: ctx.calendarItems,
    openTasks,
    calendarByDay: new Map(),
    now: new Date(),
    zone,
  });

  const dropped = proposals.filter((p) => p.discarded !== null);
  console.log(
    `[Actions] ${mails.length} mail(s) read, ${answer.actions.length} action(s) proposed, ${offered} offered` +
      (dropped.length > 0 ? `, ${dropped.length} discarded (${dropped.map((p) => p.discarded).join(", ")})` : ""),
  );

  return { proposals, tokensIn: usage.tokensIn, tokensOut: usage.tokensOut, aiCalls: 1 };
}

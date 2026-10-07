/**
 * Quick actions (Phase 5): one separate extraction-shaped model call (prompt section `quick_actions`)
 * that decides which of the day's personal mails deserve a one-tap button. Output is strict JSON,
 * never prose in the report. Result is written by `src/actions/store.ts` into `report_actions`.
 * Model proposes, code decides:
 * - The model sees short ids ("m1", "c3", "t12"); an id that maps to nothing discards the action.
 * - Dates are wall-clock in the primary calendar's zone (`calendarTimeZone`), converted to instants
 *   here, so a UTC server cannot shift an appointment.
 * - Events are checked against the calendar on their own day, tasks against the whole open list.
 * - Caps: `MAX_PER_MAIL` per mail, `MAX_ACTIONS` per day. Thrown-out actions are still stored as
 *   `discarded` with the reason, so prompt tuning can start from the table.
 * Reads: personal mail and SMS that passed the gate, plus automated mail the gate dropped when the
 * classifier flagged an event or to-do (booking confirmations).
 * Layout: `types` (shapes, schema), `mails` (inputs), `matching` (time/similarity), `check` (validates
 * one action), this file (the call and the caps).
 */
import { activePrompt } from "../../ai/active-prompts";
import { extractJson, usageTally } from "../../ai/openai";
import { calendarTimeZone } from "../../ingest/google";
import { isTargeted, matchesItem, selectStepNotes } from "../../notes/select";
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

/** The standing instructions for the day's mails: untargeted `actions` notes, plus targeted ones that apply to at least one of the mails. */
async function instructionsFor(runDate: string, mails: Mail[]): Promise<string[]> {
  const rows = await selectStepNotes("actions", runDate);
  return rows
    .filter((note) => !isTargeted(note.appliesTo) || mails.some((mail) => matchesItem(note.appliesTo, { sender: mail.sender, text: mail.text })))
    .map((note) => note.content);
}

function buildPayload(ctx: ActionInputs, runDate: string, zone: string, mails: Mail[], refs: Pick<Refs, "events" | "tasks">, instructions: string[]) {
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
    // Personal scope only (the `actions` step): global notes carry the weekly meta-run's prompt
    // proposals, which are not instructions about the reader's mail.
    instructions,
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

  const [openTasks, zone, instructions] = await Promise.all([openTodos(runDate), calendarTimeZone(), instructionsFor(runDate, mails)]);
  const events = new Map(ctx.calendarItems.map((event, i) => [`c${i + 1}`, event]));
  const tasks = new Map(openTasks.map((task, i) => [`t${i + 1}`, task]));

  const prompt = await activePrompt("quick_actions");
  const usage = usageTally();
  const answer = await extractJson<{ actions: ModelAction[] }>(
    prompt.text,
    JSON.stringify(buildPayload(ctx, runDate, zone, mails, { events, tasks }, instructions)),
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

import type { PageServerLoad, Actions } from "./$types";
import { fail } from "@sveltejs/kit";
import { sql } from "#lib/server/postgres.js";
import { parseJsonb } from "#lib/jsonb.js";

/**
 * The question queue, one question at a time.
 *
 * Reads straight from Postgres; every write goes through the bridge, where `src/questions/store.ts`
 * is the only writer, so an answer here and the pipeline's reconcile cannot overwrite each other.
 * Online-only: a queued answer replayed after the gate has timed out would arrive too late for the
 * briefing it was for, and a question the pipeline has since merged or closed is not there to take it.
 */

const API = process.env.SKILLS_BRIDGE_URL ?? "http://localhost:4000";

/** How many closed questions the page lists: enough to see what the assistant did lately. */
const CLOSED_LIMIT = 30;

interface Source {
  extraction_id: string | null;
  from: string;
  subject: string | null;
  source_type: string;
  run_date: string;
}

interface Revision {
  question: string;
  at: string;
  by: "model" | "user";
  reason: string | null;
}

interface Row {
  id: string;
  kind: string;
  question: string;
  status: string;
  status_detail: string | null;
  merged_into: string | null;
  answer: string | null;
  sources: unknown;
  history: unknown;
  first_asked: string;
  last_asked: string;
  times_asked: number;
  blocks_until: Date | null;
  answered_at: Date | null;
  updated_at: Date;
}

function shape(row: Row) {
  const blocksUntil = row.blocks_until ? new Date(row.blocks_until) : null;
  const minutesLeft = blocksUntil ? Math.round((blocksUntil.getTime() - Date.now()) / 60_000) : null;
  return {
    id: row.id,
    kind: row.kind,
    question: row.question,
    status: row.status,
    statusDetail: row.status_detail,
    mergedInto: row.merged_into,
    answer: row.answer,
    sources: parseJsonb<Source[]>(row.sources, []),
    history: parseJsonb<Revision[]>(row.history, []),
    firstAsked: row.first_asked,
    lastAsked: row.last_asked,
    timesAsked: row.times_asked,
    // Only while a run is actually waiting: a stale value from a run that died means nothing.
    blockingMinutesLeft: minutesLeft !== null && minutesLeft > 0 ? minutesLeft : null,
    answeredAt: row.answered_at,
    updatedAt: row.updated_at,
  };
}

export type QuestionView = ReturnType<typeof shape>;

export const load: PageServerLoad = async () => {
  const db = sql();
  const columns = () => db`
    id, kind, question, status, status_detail, merged_into, answer, sources, history,
    first_asked::text AS first_asked, last_asked::text AS last_asked, times_asked,
    blocks_until, answered_at, updated_at
  `;
  const [open, closed] = await Promise.all([
    db<Row[]>`
      SELECT ${columns()} FROM questions
      WHERE status = 'open'
      ORDER BY (blocks_until > now()) IS TRUE DESC, (kind = 'item') DESC, last_asked DESC, created_at
    `,
    db<Row[]>`
      SELECT ${columns()} FROM questions
      WHERE status <> 'open'
      ORDER BY updated_at DESC
      LIMIT ${CLOSED_LIMIT}
    `,
  ]);

  const openViews = open.map(shape);
  // A merged question points at its target by id; the page names the target instead.
  const targets = new Map([...open, ...closed].map((r) => [r.id, r.question]));
  const closedViews = closed.map((r) => ({ ...shape(r), mergedIntoText: r.merged_into ? targets.get(r.merged_into) ?? null : null }));

  return { open: openViews, closed: closedViews };
};

async function bridge(id: string, op: string, body?: unknown) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(400, { id, error: "Invalid question id" });
  try {
    const res = await fetch(`${API}/api/questions/${id}/${op}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) return fail(res.status, { id, error: json.error ?? "The skills bridge returned an error." });
    return { id, op };
  } catch {
    return fail(503, { id, error: `The skills bridge is not reachable (${API}).` });
  }
}

export const actions: Actions = {
  answer: async ({ request }) => {
    const data = await request.formData();
    const id = String(data.get("id") ?? "");
    const answer = String(data.get("answer") ?? "").trim();
    if (!answer) return fail(400, { id, error: "Write an answer first, or dismiss the question." });
    return bridge(id, "answer", { answer });
  },
  dismiss: async ({ request }) => bridge(String((await request.formData()).get("id") ?? ""), "dismiss"),
  reopen: async ({ request }) => bridge(String((await request.formData()).get("id") ?? ""), "reopen"),
};

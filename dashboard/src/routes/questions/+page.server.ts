import { isUuid } from "$pipeline/util/ids";
import { readForm } from "#lib/server/form.js";
import type { PageServerLoad, Actions } from "./$types";
import { fail } from "@sveltejs/kit";
import { bridgeAction, jsonPost } from "#lib/server/bridge.js";
import { sql } from "#lib/server/postgres.js";
import { parseJsonb } from "#lib/jsonb.js";

/**
 * The question queue, one question at a time.
 *
 * Reads straight from Postgres; every write goes through the bridge, where `src/questions/store.ts`
 * is the only writer, so an answer here and the pipeline's reconcile cannot overwrite each other.
 * Online-only: a question the pipeline has since merged or closed is not there to take a queued answer.
 */

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
  answered_at: Date | null;
  updated_at: Date;
}

function shape(row: Row) {
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
    answered_at, updated_at
  `;
  const open = await db<Row[]>`
    SELECT ${columns()} FROM questions
    WHERE status = 'open'
    ORDER BY (kind = 'item') DESC, last_asked DESC, created_at
  `;

  const openViews = open.map(shape);
  return { open: openViews };
};

function bridge(id: string, op: string, body?: unknown) {
  if (!isUuid(id)) return fail(400, { id, error: "Invalid question id" });
  return bridgeAction(`/api/questions/${id}/${op}`, jsonPost(body), () => ({ id, op }), { id });
}

export const actions: Actions = {
  answer: async ({ request }) => {
    const form = await readForm(request);
    const id = form.text("id");
    const answer = form.text("answer");
    if (!answer) return fail(400, { id, error: "Write an answer first, or dismiss the question." });
    return bridge(id, "answer", { answer });
  },
  dismiss: async ({ request }) => bridge((await readForm(request)).text("id"), "dismiss"),
  reopen: async ({ request }) => bridge((await readForm(request)).text("id"), "reopen"),
};

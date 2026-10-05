import { isUuid } from "$pipeline/util/ids";
import { readForm } from "#lib/server/form.js";
import type { Actions, PageServerLoad } from "./$types";
import { fail } from "@sveltejs/kit";
import { bridgeAction } from "#lib/server/bridge.js";
import { sql } from "#lib/server/postgres.js";

// /questions/closed: the latest CLOSED_LIMIT non-open questions, read from Postgres. Online-only
// (see onlineOnly.ts). `reopen` / `reprocess` ("Run again") forward to the bridge like /questions.
const CLOSED_LIMIT = 100;

interface Row {
  id: string;
  kind: string;
  question: string;
  status: string;
  status_detail: string | null;
  answer: string | null;
  updated_at: Date;
  answered_at: Date | null;
  merged_question: string | null;
  answer_status: string | null;
  answer_outcome: string | null;
  answer_conversation_id: string | null;
}

export const load: PageServerLoad = async () => {
  const closed = await sql()<Row[]>`
    SELECT
      q.id, q.kind, q.question, q.status, q.status_detail, q.answer, q.updated_at, q.answered_at,
      q.answer_status, q.answer_outcome, q.answer_conversation_id,
      target.question AS merged_question
    FROM questions q
    LEFT JOIN questions target ON target.id = q.merged_into
    WHERE q.status <> 'open'
    ORDER BY q.updated_at DESC
    LIMIT ${CLOSED_LIMIT}
  `;

  return {
    closed: closed.map((q) => ({
      id: q.id,
      kind: q.kind,
      question: q.question,
      status: q.status,
      statusDetail: q.status_detail,
      answer: q.answer,
      updatedAt: q.updated_at,
      answeredAt: q.answered_at,
      mergedQuestion: q.merged_question,
      answerStatus: q.answer_status,
      answerOutcome: q.answer_outcome,
      answerConversationId: q.answer_conversation_id,
    })),
  };
};

async function bridge(request: Request, op: "reopen" | "reprocess") {
  const id = (await readForm(request)).text("id");
  if (!isUuid(id)) return fail(400, { id, error: "Invalid question id" });

  return bridgeAction(`/api/questions/${id}/${op}`, { method: "POST" }, () => ({ id, op }), { id });
}

export const actions: Actions = {
  reopen: ({ request }) => bridge(request, "reopen"),
  reprocess: ({ request }) => bridge(request, "reprocess"),
};

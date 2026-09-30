import type { Actions, PageServerLoad } from "./$types";
import { fail } from "@sveltejs/kit";
import { sql } from "#lib/server/postgres.js";

const API = process.env.SKILLS_BRIDGE_URL ?? "http://localhost:4000";
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
}

export const load: PageServerLoad = async () => {
  const closed = await sql()<Row[]>`
    SELECT
      q.id, q.kind, q.question, q.status, q.status_detail, q.answer, q.updated_at, q.answered_at,
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
    })),
  };
};

export const actions: Actions = {
  reopen: async ({ request }) => {
    const id = String((await request.formData()).get("id") ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(400, { id, error: "Invalid question id" });

    try {
      const res = await fetch(`${API}/api/questions/${id}/reopen`, { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) return fail(res.status, { id, error: json.error ?? "The skills bridge returned an error." });
      return { id, reopened: true };
    } catch {
      return fail(503, { id, error: `The skills bridge is not reachable (${API}).` });
    }
  },
};

import type { PageServerLoad, Actions } from "./$types";
import { fail } from "@sveltejs/kit";
import { sql } from "$lib/db";

interface GateQuestion {
  id: string;
  item_type: string;
  from: string;
  subject?: string;
  question: string;
}

interface GateAnswer {
  id: string;
  answer: string;
}

interface GateSession {
  id: string;
  run_id: string;
  run_date: string;
  questions: GateQuestion[];
  status: string;
  timeout_at: string;
  created_at: string;
}

export const load: PageServerLoad = async () => {
  const rows = await sql()<GateSession[]>`
    SELECT id, run_id, run_date, questions, status, timeout_at, created_at
    FROM question_gate_sessions
    WHERE status = 'pending'
    ORDER BY created_at DESC
    LIMIT 1
  `;

  if (rows.length === 0) return { session: null };

  const session = rows[0];
  const timeoutAt = new Date(session.timeout_at);
  const minutesLeft = Math.max(0, Math.round((timeoutAt.getTime() - Date.now()) / 60_000));

  return {
    session: {
      runId: session.run_id,
      runDate: session.run_date,
      questions: session.questions as GateQuestion[],
      minutesLeft,
      createdAt: session.created_at,
    },
  };
};

export const actions: Actions = {
  answer: async ({ request }) => {
    const data = await request.formData();
    const runId = data.get("run_id") as string;

    if (!runId) return fail(400, { error: "Missing run_id" });

    const [session] = await sql()<{ run_id: string; questions: GateQuestion[]; run_date: string; status: string }[]>`
      SELECT run_id, questions, run_date, status FROM question_gate_sessions WHERE run_id = ${runId} LIMIT 1
    `;

    if (!session) return fail(404, { error: "Session not found" });
    if (session.status !== "pending") return fail(409, { error: "Session already resolved" });

    const questions = session.questions as GateQuestion[];
    const answers: GateAnswer[] = questions
      .map((q) => ({ id: q.id, answer: (data.get(`answer_${q.id}`) as string | null)?.trim() ?? "" }))
      .filter((a) => a.answer.length > 0);

    if (answers.length === 0) return fail(400, { error: "No answers provided" });

    const now = new Date().toISOString();
    await sql()`
      UPDATE question_gate_sessions
      SET status = 'answered', answers = ${sql().json(answers as never)}, answered_at = ${now}
      WHERE run_id = ${runId}
    `;

    // Contact learning
    for (const answer of answers) {
      const question = questions.find((q) => q.id === answer.id);
      if (!question) continue;
      await sql()`
        INSERT INTO contacts (identifier, relationship, first_seen)
        VALUES (${question.from}, ${answer.answer}, ${session.run_date})
        ON CONFLICT (identifier) DO UPDATE
          SET relationship = excluded.relationship, updated_at = now()
      `;
    }

    return { success: true, answeredCount: answers.length };
  },
};

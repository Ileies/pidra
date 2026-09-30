import type { Actions, PageServerLoad } from "./$types";
import { fail } from "@sveltejs/kit";
import { parseJsonb } from "#lib/jsonb.js";
import type { StepAttempt } from "#lib/pipeline.js";
import { acknowledgeNotification, reportNotificationKey, runNotificationKey } from "#lib/server/notifications.js";
import { sql } from "#lib/server/postgres.js";

interface ReportRow {
  report_date: string;
  created_at: Date;
}

interface RunRow {
  id: string;
  run_date: string;
  status: string;
  failed_step: string | null;
  step_errors: unknown;
  started_at: Date | null;
}

export const load: PageServerLoad = async () => {
  const db = sql();
  const [questions, reports, runs] = await Promise.all([
    db`SELECT id, question, kind, first_asked::text AS first_asked FROM questions WHERE status = 'open' ORDER BY last_asked DESC`,
    db<ReportRow[]>`
      SELECT d.report_date::text AS report_date, d.created_at
      FROM daily_reports d
      LEFT JOIN notification_reads n ON n.notification_key = 'report:' || d.report_date::text
      WHERE n.notification_key IS NULL
      ORDER BY d.report_date DESC
    `,
    db<RunRow[]>`
      SELECT r.id::text, r.run_date::text AS run_date, r.status, r.failed_step, r.step_errors, r.started_at
      FROM pipeline_runs r
      LEFT JOIN notification_reads n ON n.notification_key = 'run:' || r.id::text
      WHERE n.notification_key IS NULL
        AND (r.status = 'failed' OR COALESCE(jsonb_array_length(r.step_errors), 0) > 0)
      ORDER BY r.started_at DESC
    `,
  ]);

  return {
    questions: questions.map((q) => ({ id: q.id as string, question: q.question as string, kind: q.kind as string, firstAsked: q.first_asked as string })),
    reports: reports.map((r) => ({ date: r.report_date, createdAt: r.created_at })),
    runs: runs.map((r) => ({
      id: r.id,
      date: r.run_date,
      status: r.status,
      failedStep: r.failed_step,
      attempts: parseJsonb<StepAttempt[]>(r.step_errors, []),
      startedAt: r.started_at,
    })),
  };
};

export const actions: Actions = {
  readReport: async ({ request }) => {
    const date = String((await request.formData()).get("date") ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail(400, { error: "Invalid report date." });
    await acknowledgeNotification(reportNotificationKey(date));
    return { readReport: date };
  },
  reviewRun: async ({ request }) => {
    const id = String((await request.formData()).get("id") ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(400, { error: "Invalid run id." });
    await acknowledgeNotification(runNotificationKey(id));
    return { reviewedRun: id };
  },
};

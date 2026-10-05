import type { PageServerLoad } from "./$types";
import { sql } from "#lib/server/postgres.js";
import { parseJsonb } from "#lib/jsonb.js";

// `/skills/executions` (online-only): the last 100 non-pending `skill_executions` rows, newest first.
interface SkillExecution {
  id: string;
  run_date: string;
  skill_name: string;
  parameters: Record<string, unknown> | null;
  status: string;
  result: string | null;
  triggered_by: string | null;
  created_at: string;
}

export const load: PageServerLoad = async () => {
  const rows = await sql()`
    SELECT id, run_date, skill_name, parameters, status, result, triggered_by, created_at
    FROM skill_executions
    WHERE status <> 'pending'
    ORDER BY created_at DESC
    LIMIT 100
  `;

  const executions = rows.map((row) => ({
    ...row,
    parameters: parseJsonb<Record<string, unknown> | null>(row.parameters, null),
  })) as SkillExecution[];

  return {
    executions,
  };
};

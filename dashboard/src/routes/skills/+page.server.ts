import type { PageServerLoad } from "./$types";
import { sql } from "$lib/db";
import { parseJsonb } from "$lib/jsonb";

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
    ORDER BY created_at DESC
    LIMIT 100
  `;

  return {
    executions: rows.map((row) => ({
      ...row,
      parameters: parseJsonb<Record<string, unknown> | null>(row.parameters, null),
    })) as SkillExecution[],
  };
};

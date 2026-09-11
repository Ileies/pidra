import type { Actions, PageServerLoad } from "./$types";
import { fail } from "@sveltejs/kit";
import { sql } from "$lib/db";
import { parseJsonb } from "$lib/jsonb";

const API = process.env.SKILLS_BRIDGE_URL ?? "http://localhost:4000";

interface SkillParam {
  type: string;
  required: boolean;
  description?: string;
}

export interface SkillInfo {
  name: string;
  description: string;
  risk_level: "low" | "medium" | "high" | "critical";
  parameters: Record<string, SkillParam>;
  enabled: boolean;
  base: {
    description: string;
    risk_level: "low" | "medium" | "high" | "critical";
  };
  overridden: boolean;
}

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
  const [skillsRes, rows] = await Promise.all([
    fetch(`${API}/skills`).catch(() => null),
    sql()`
      SELECT id, run_date, skill_name, parameters, status, result, triggered_by, created_at
      FROM skill_executions
      ORDER BY created_at DESC
      LIMIT 100
    `,
  ]);

  const skills: SkillInfo[] = skillsRes?.ok ? await skillsRes.json() : [];

  const executions = rows.map((row) => ({
    ...row,
    parameters: parseJsonb<Record<string, unknown> | null>(row.parameters, null),
  })) as SkillExecution[];

  return { skills, executions };
};

export const actions: Actions = {
  update: async ({ request }) => {
    const data = await request.formData();
    const skillName = data.get("skillName") as string;
    if (!skillName) return fail(400, { error: "skillName required" });

    const parameterDescriptions: Record<string, string> = {};
    for (const [key, value] of data.entries()) {
      if (key.startsWith("param:")) parameterDescriptions[key.slice("param:".length)] = String(value);
    }

    const body = {
      enabled: data.get("enabled") === "true",
      risk_level: data.get("riskLevel") as string,
      description: data.get("description") as string,
      parameter_descriptions: parameterDescriptions,
    };

    const res = await fetch(`${API}/skills/${encodeURIComponent(skillName)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) return fail(res.status, { error: (await res.json().catch(() => ({}))).error ?? "API error" });
    return { ok: true };
  },

  reset: async ({ request }) => {
    const data = await request.formData();
    const skillName = data.get("skillName") as string;
    if (!skillName) return fail(400, { error: "skillName required" });

    const res = await fetch(`${API}/skills/${encodeURIComponent(skillName)}/override`, { method: "DELETE" });
    if (!res.ok) return fail(res.status, { error: "API error" });
    return { ok: true };
  },
};

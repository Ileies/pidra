import type { Actions, PageServerLoad } from "./$types";
import { fail } from "@sveltejs/kit";
import { sql } from "#lib/db.js";
import { parseJsonb } from "#lib/jsonb.js";

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

  // `pending` means a high-risk call is waiting for the owner. It leads the page rather than
  // sitting somewhere in a reverse-chronological log: it is the one thing here that blocks.
  return {
    skills,
    executions: executions.filter((execution) => execution.status !== "pending"),
    pending: executions.filter((execution) => execution.status === "pending"),
  };
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

  /**
   * The confirm/reject half of the high-risk queue (D4).
   *
   * CLAUDE.md specifies that a `high`-risk skill is inserted as `pending` and waits for manual
   * confirmation. `executeSkill` did its half; nothing could ever complete the other, so a queued
   * call sat in the log forever. It goes through the bridge rather than writing the row here,
   * because confirming means actually running the skill - and `executeSkill` is the only path a
   * skill may run through.
   */
  resolve: async ({ request }) => {
    const data = await request.formData();
    const id = (data.get("id") as string | null)?.trim();
    const decision = data.get("decision") as string | null;
    const reason = (data.get("reason") as string | null) ?? undefined;

    if (!id) return fail(400, { error: "Missing execution id" });
    if (decision !== "confirm" && decision !== "reject") return fail(400, { error: "Invalid decision" });

    try {
      const res = await fetch(`${API}/api/skills/executions/${encodeURIComponent(id)}/${decision}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; status?: string; result?: string; reason?: string };
      if (!res.ok) return fail(res.status, { error: body.error ?? "The skills bridge returned an error." });

      return {
        ok: true,
        message:
          body.status === "executed"
            ? `Ran it: ${body.result ?? "done"}`
            : `Rejected: ${body.reason ?? "no reason given"}`,
      };
    } catch {
      return fail(503, { error: "The skills bridge is not reachable (localhost:4000)." });
    }
  },
};

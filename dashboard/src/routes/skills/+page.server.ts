import type { Actions, PageServerLoad } from "./$types";
import { readForm } from "#lib/server/form.js";
import { fail } from "@sveltejs/kit";
import { bridgeAction, bridgeFetch, jsonPost } from "#lib/server/bridge.js";
import { sql } from "#lib/server/postgres.js";
import { parseJsonb } from "#lib/jsonb.js";
import { LOCAL_SKILLS } from "./catalog.js";

export interface SkillInfo {
  name: string;
  description: string;
  risk_level: "low" | "medium" | "high" | "critical";
  enabled: boolean;
  /** Executions in the last 30 days, pending ones excluded. */
  uses: number;
}

interface PendingExecution {
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
  // The bridge owns edits and execution, but the registered catalog is part of this checkout
  // (`./catalog.ts`), so the page can still list skills (read-only data, no toggling) while the bridge is down.
  const [skillsRes, usageRows, pendingRows] = await Promise.all([
    bridgeFetch("/skills").catch(() => null),
    sql()`
      SELECT skill_name, count(*)::int AS uses
      FROM skill_executions
      WHERE created_at > now() - interval '30 days' AND status <> 'pending'
      GROUP BY skill_name
    `,
    sql()`
      SELECT id, run_date, skill_name, parameters, status, result, triggered_by, created_at
      FROM skill_executions
      WHERE status = 'pending'
      ORDER BY created_at DESC
      LIMIT 100
    `,
  ]);

  const localSkills: SkillInfo[] = LOCAL_SKILLS.map((skill) => ({
    name: skill.name,
    description: skill.description,
    risk_level: skill.risk_level,
    enabled: skill.enabled ?? true,
    uses: 0,
  }));
  const baseSkills: Omit<SkillInfo, "uses">[] = skillsRes?.ok ? await skillsRes.json() : localSkills;
  const usage = new Map<string, number>(usageRows.map((row) => [row.skill_name as string, Number(row.uses)]));
  const skills: SkillInfo[] = baseSkills.map((skill) => ({ ...skill, uses: usage.get(skill.name) ?? 0 }));

  const pending = pendingRows.map((row) => ({
    ...row,
    parameters: parseJsonb<Record<string, unknown> | null>(row.parameters, null),
  })) as PendingExecution[];

  return {
    skills,
    pending,
  };
};

export const actions: Actions = {
  update: async ({ request }) => {
    const form = await readForm(request);
    const skillName = form.text("skillName");
    if (!skillName) return fail(400, { error: "skillName required" });

    return bridgeAction(
      `/skills/${encodeURIComponent(skillName)}`,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: form.flag("enabled") }) },
      () => ({ ok: true }),
    );
  },

  /**
   * Confirm/reject a `pending` high-risk execution. Goes through the bridge rather than writing the
   * row here: confirming actually runs the skill, and `executeSkill` is the only path a skill may
   * run through (`docs/skills.md`).
   */
  resolve: async ({ request }) => {
    const form = await readForm(request);
    const id = form.text("id");
    const decision = form.text("decision");
    const reason = (form.text("reason")) ?? undefined;

    if (!id) return fail(400, { error: "Missing execution id" });
    if (decision !== "confirm" && decision !== "reject") return fail(400, { error: "Invalid decision" });

    return bridgeAction(
      `/api/skills/executions/${encodeURIComponent(id)}/${decision}`,
      jsonPost({ reason }),
      (body: { status?: string; result?: string; reason?: string }) => ({
        ok: true,
        message:
          body.status === "executed"
            ? `Ran it: ${body.result ?? "done"}`
            : `Rejected: ${body.reason ?? "no reason given"}`,
      }),
    );
  },
};

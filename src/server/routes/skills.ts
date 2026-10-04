import { Hono } from "hono";
import { executeSkill, resolvePendingSkill } from "../../skills/execute";
import { listEffectiveSkills, setSkillEnabled } from "../../skills/overrides";
import { bodyOf } from "../http";

export const skills = new Hono();

skills.get("/skills", async (c) => c.json(await listEffectiveSkills()));

skills.patch("/skills/:name", async (c) => {
  const body = await bodyOf<{ enabled: boolean }>(c);
  if (typeof body.enabled !== "boolean") return c.json({ error: "enabled must be a boolean" }, 400);
  return c.json(await setSkillEnabled(c.req.param("name"), body.enabled));
});

skills.post("/skills/execute", async (c) => {
  const body = await bodyOf<{ skill: string; parameters: Record<string, unknown>; triggered_by: string }>(c);
  const { skill, parameters = {}, triggered_by = "manual" } = body;
  if (!skill) return c.json({ error: "skill is required" }, 400);

  // Risk gating and the audit log live in executeSkill, shared with the chat loop.
  const outcome = await executeSkill(skill, parameters, triggered_by);

  switch (outcome.status) {
    case "unknown_skill":
      return c.json({ error: outcome.message }, 404);
    case "rejected":
      return c.json({ status: "rejected", reason: outcome.message }, 403);
    case "pending_confirmation":
      return c.json({ status: "pending_confirmation", message: outcome.message, execution_id: outcome.executionId }, 202);
    case "failed":
      return c.json({ status: "failed", error: outcome.message }, 500);
    default:
      return c.json({ status: "executed", result: outcome.message });
  }
});

// The other half of the high-risk queue. `executeSkill` parks a high-risk call as `pending` and
// says it is queued on /skills; this is what /skills calls to finish the decision.
skills.post("/api/skills/executions/:id/:decision", async (c) => {
  const decision = c.req.param("decision");
  if (decision !== "confirm" && decision !== "reject") {
    return c.json({ error: "decision must be confirm or reject" }, 400);
  }

  const { reason } = await bodyOf<{ reason: string }>(c);
  const outcome = await resolvePendingSkill(c.req.param("id"), decision, reason);

  switch (outcome.status) {
    case "unknown_skill":
      return c.json({ error: outcome.message }, 404);
    case "rejected":
      return c.json({ status: "rejected", reason: outcome.message });
    case "failed":
      return c.json({ status: "failed", error: outcome.message }, 500);
    default:
      return c.json({ status: "executed", result: outcome.message });
  }
});

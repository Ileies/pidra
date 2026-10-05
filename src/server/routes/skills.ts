import { Hono } from "hono";
import { resolvePendingSkill } from "../../skills/execute";
import { listEffectiveSkills, setSkillEnabled } from "../../skills/overrides";
import { bodyOf } from "../http";

export const skills = new Hono();

skills.get("/skills", async (c) => c.json(await listEffectiveSkills()));

skills.patch("/skills/:name", async (c) => {
  const body = await bodyOf<{ enabled: boolean }>(c);
  if (typeof body.enabled !== "boolean") return c.json({ error: "enabled must be a boolean" }, 400);
  return c.json(await setSkillEnabled(c.req.param("name"), body.enabled));
});

// Finishes the high-risk queue: `/skills` confirms or rejects a `pending` call here (resolvePendingSkill).
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

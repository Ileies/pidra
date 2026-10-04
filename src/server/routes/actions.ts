import { Hono } from "hono";
import { dismissAction, restoreAction, runAction } from "../../actions/store";
import { uuidParam } from "../http";

// The report's one-tap buttons (`src/actions/`). The dashboard is the only caller and it is the
// owner tapping, so the skill runs attributed to them. `run` is safe to repeat: a second tap on a
// done action answers with the first result instead of adding the event again.
const OPS = {
  run: (id: string) => runAction(id),
  dismiss: async (id: string) => ({ action: await dismissAction(id), message: "Dismissed" }),
  restore: async (id: string) => ({ action: await restoreAction(id), message: "Restored" }),
} as const;

export const actions = new Hono();

actions.post("/api/actions/:id/:op", uuidParam(), async (c) => {
  const op = c.req.param("op");
  if (!(op in OPS)) return c.json({ error: "op must be run, dismiss or restore" }, 400);

  const { action, message } = await OPS[op as keyof typeof OPS](c.req.param("id"));
  return c.json({ id: action.id, status: action.status, message });
});

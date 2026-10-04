import { Hono } from "hono";
import { deepen } from "../../ai/deepen";
import { runPipeline } from "../../pipeline/run";
import { isUuid } from "../../util/ids";
import { utcDay } from "../../util/time";
import { bodyOf } from "../http";

export const pipeline = new Hono();

pipeline.post("/api/pipeline/run", (c) => {
  const date = utcDay();
  runPipeline(date).catch(console.error);
  return c.json({ status: "started", date });
});

pipeline.post("/api/deepen", async (c) => {
  const { ids } = await bodyOf<{ ids: string[] }>(c);
  const valid = (ids ?? []).filter(isUuid).slice(0, 10);
  if (valid.length === 0) return c.json({ error: "No valid IDs" }, 400);
  return c.json({ text: await deepen(valid) });
});

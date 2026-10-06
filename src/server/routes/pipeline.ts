import { and, eq, gt, sql } from "drizzle-orm";
import { Hono } from "hono";
import { deepen } from "../../ai/deepen";
import { db, pipelineRuns } from "../../db";
import { runPipeline } from "../../pipeline/run";
import { HttpError } from "../../util/errors";
import { isUuid } from "../../util/ids";
import { utcDay } from "../../util/time";
import { bodyOf } from "../http";

export const pipeline = new Hono();

// A run that died with its process stays `running` forever; past this age it no longer blocks a new one.
const RUN_STALE_HOURS = 3;

pipeline.post("/api/pipeline/run", async (c) => {
  const [active] = await db
    .select({ id: pipelineRuns.id })
    .from(pipelineRuns)
    .where(and(eq(pipelineRuns.status, "running"), gt(pipelineRuns.startedAt, sql`now() - make_interval(hours => ${RUN_STALE_HOURS})`)))
    .limit(1);
  if (active) throw new HttpError("A pipeline run is already in progress", 409);

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

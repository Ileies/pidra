import { Hono } from "hono";
import { recordCorrection, revertCorrection, type Operation, type TargetKind } from "../../context/corrections";
import { bodyOf, uuidParam } from "../http";

export const context = new Hono();

/**
 * Record a correction directly, for the dashboard's own editing surfaces (D7).
 *
 * `/contacts` lets the owner fix a name or a relationship inline, and that has to behave exactly
 * as the `revise_context` skill does: the row merge is field-level, the pre-merge row is
 * snapshotted into `previous_state`, and the row is locked against a re-seed. So it goes through
 * `recordCorrection`, the single writer, rather than the dashboard reaching for the table.
 */
context.post("/api/context/corrections", async (c) => {
  const body = await bodyOf<{
    target_kind: string;
    target_key: string;
    operation: string;
    statement: string;
    supersedes: string | null;
    rationale: string | null;
    fields: Record<string, unknown> | null;
    source: string;
  }>(c);

  const result = await recordCorrection({
    targetKind: String(body.target_kind ?? "") as TargetKind,
    targetKey: String(body.target_key ?? ""),
    operation: String(body.operation ?? "amend") as Operation,
    statement: String(body.statement ?? ""),
    supersedesText: body.supersedes ?? null,
    rationale: body.rationale ?? null,
    fields: body.fields ?? null,
    source: body.source ?? "dashboard",
  });
  return c.json({ ok: true, ...result });
});

context.post("/api/context/corrections/:id/revert", uuidParam(), async (c) =>
  c.json({ ok: true, message: await revertCorrection(c.req.param("id")) }));

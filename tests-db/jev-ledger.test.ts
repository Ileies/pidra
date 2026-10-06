// src/ai/jev-ledger.ts against real SQL: one row per decision identity, a retry replaces a failure
// but never a success, off results leave no trace, and no source text is stored. No mocks.
import { beforeEach, describe, expect, test } from "bun:test";
import { useTestDatabase } from "./fixtures/database";

const database = await useTestDatabase();
const { db, jevDecisions, pipelineRuns } = await import("../src/db");
const { recordJevDecision, stateHash } = await import("../src/ai/jev-ledger");
const { JEV_MODEL } = await import("../src/ai/jev");

let runId = "";
beforeEach(async () => {
  await database.sql`truncate pipeline_runs cascade`;
  [{ id: runId }] = await db.insert(pipelineRuns).values({ runDate: "2026-10-05" }).returning({ id: pipelineRuns.id });
});

const base = { task: "news_impact", model: JEV_MODEL, rubricVersion: "synthetic-v1", mode: "shadow" } as const;
const ok = { ...base, status: "ok", answers: { impact: { type: "score", score: 1.2 } }, tokensIn: 100, tokensOut: 20, latencyMs: 300 } as never;
const failed = { ...base, status: "error", code: "timeout", message: "Jev request timed out", latencyMs: 8000 } as never;
const entry = (over: Record<string, unknown> = {}) => ({ runId, subjectKey: "story-1", state: "Synthetic public event", ...over });
const rows = () => db.select().from(jevDecisions);

describe("jev ledger", () => {
  test("off results record nothing", async () => {
    const off = { ...base, mode: "off", status: "off" } as never;
    expect(await recordJevDecision(off, entry())).toBe(false);
    expect(await rows()).toHaveLength(0);
  });

  test("stores answers, usage and a hash, not the state text", async () => {
    expect(await recordJevDecision(ok, entry())).toBe(true);
    const [row] = await rows();
    expect(row.status).toBe("ok");
    expect(row.tokensIn).toBe(100);
    expect(row.stateHash).toBe(stateHash("Synthetic public event"));
    expect(JSON.stringify(row)).not.toContain("Synthetic public event");
    expect(row.influencedReport).toBe(false);
  });

  test("a retry is idempotent and replaces a failure with the success", async () => {
    await recordJevDecision(failed, entry());
    await recordJevDecision(ok, entry());
    await recordJevDecision(ok, entry());
    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe("ok");
  });

  test("a later failure never overwrites a recorded success", async () => {
    await recordJevDecision(ok, entry());
    await recordJevDecision(failed, entry());
    const [row] = await rows();
    expect(row.status).toBe("ok");
    expect(row.errorCode).toBeNull();
  });

  test("a failure is recorded with its code", async () => {
    await recordJevDecision(failed, entry());
    const [row] = await rows();
    expect(row.status).toBe("error");
    expect(row.errorCode).toBe("timeout");
    expect(row.answers).toBeNull();
  });

  test("a different subject or rubric version is its own row", async () => {
    await recordJevDecision(ok, entry());
    await recordJevDecision(ok, entry({ subjectKey: "story-2" }));
    await recordJevDecision({ ...(ok as object), rubricVersion: "synthetic-v2" } as never, entry());
    expect(await rows()).toHaveLength(3);
  });

  test("a shadow decision changes nothing outside the ledger", async () => {
    const sql = database.sql;
    const [raw] = await sql`insert into raw_items (run_date, source_type, raw_content) values ('2026-10-05', 'web_news', 'x') returning id`;
    await sql`insert into extractions (raw_item_id, run_date, relevance_score, gate_passed, included_in_report) values (${raw!.id}, '2026-10-05', 4, true, false)`;
    await sql`insert into daily_reports (report_date, full_report) values ('2026-10-05', 'final report')`;
    const snapshot = async () => JSON.stringify([
      await sql`select * from raw_items order by id`,
      await sql`select * from extractions order by id`,
      await sql`select * from daily_reports order by id`,
      await sql`select * from report_actions order by id`,
      await sql`select * from skill_executions order by id`,
      await sql`select id, status, step_errors from pipeline_runs order by id`,
    ]);
    const before = await snapshot();
    await recordJevDecision(ok, entry());
    await recordJevDecision(failed, entry({ subjectKey: "story-2" }));
    expect(await snapshot()).toBe(before);
    expect(await rows()).toHaveLength(2);
  });

  test("a write failure returns false instead of throwing", async () => {
    expect(await recordJevDecision(ok, entry({ runId: "00000000-0000-0000-0000-000000000000" }))).toBe(false);
  });
});

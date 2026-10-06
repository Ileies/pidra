// The Jev block of /runs/[id] against real SQL: the ledger is summarised per task and mode, apart
// from the run's own counts, and a run without Jev rows (or without the table) shows nothing.
import { beforeEach, describe, expect, test } from "bun:test";
import { setPrivateEnv } from "./fixtures/dashboard";
import { useTestDatabase } from "./fixtures/database";

const database = await useTestDatabase();
setPrivateEnv();
const { load } = await import("../dashboard/src/routes/runs/[id]/+page.server");

let runId = "";
beforeEach(async () => {
  await database.sql`truncate pipeline_runs cascade`;
  [{ id: runId }] = await database.sql`insert into pipeline_runs (run_date, status) values ('2026-10-05', 'completed') returning id`;
});

const row = (subject: string, over: Record<string, unknown> = {}) => ({
  run_id: runId, task: "news_impact", subject_key: subject, model: "jev-1.13.0", rubric_version: "code",
  mode: "shadow", status: "ok", state_hash: "h", latency_ms: 200, tokens_in: 100, tokens_out: 10,
  // Every key on every row: a multi-row insert takes its columns from the first row.
  error_code: null, influenced_report: false, ...over,
});
const insert = (...rows: Record<string, unknown>[]) => database.sql`insert into jev_decisions ${database.sql(rows)}`;
const loadRun = () => load({ params: { id: runId } } as never) as Promise<{ jev: any[] }>;

describe("/runs/[id] Jev summary", () => {
  test("a run without Jev rows shows nothing", async () => {
    expect((await loadRun()).jev).toEqual([]);
  });

  test("summarises calls, failures, tokens and latency per task and mode", async () => {
    await insert(
      row("a"),
      row("b", { latency_ms: 400, tokens_in: 50 }),
      row("c", { status: "error", error_code: "timeout", latency_ms: 8000, tokens_in: null, tokens_out: null }),
      row("d", { task: "news_novelty", mode: "active", influenced_report: true }),
    );
    const { jev } = await loadRun();
    expect(jev).toHaveLength(2);
    const impact = jev.find((entry) => entry.task === "news_impact");
    expect(impact).toMatchObject({ mode: "shadow", calls: 3, failures: 1, errorCodes: ["timeout"], tokensIn: 150, tokensOut: 20, maxLatencyMs: 8000, influenced: 0 });
    expect(impact.avgLatencyMs).toBe(2867);
    expect(jev.find((entry) => entry.task === "news_novelty")).toMatchObject({ mode: "active", calls: 1, influenced: 1 });
  });

  test("another run's rows are not counted", async () => {
    const [other] = await database.sql`insert into pipeline_runs (run_date, status) values ('2026-10-04', 'completed') returning id`;
    await insert(row("a", { run_id: other!.id }));
    expect((await loadRun()).jev).toEqual([]);
  });

  test("a missing ledger table degrades to nothing", async () => {
    await database.sql`drop table jev_decisions`;
    expect((await loadRun()).jev).toEqual([]);
  });
});

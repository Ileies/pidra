// src/pipeline/stale-runs.ts against real SQL: a run left `running` long ago is closed as failed,
// a recent one and a finished one are left alone.
import { beforeEach, describe, expect, test } from "bun:test";
import { useTestDatabase } from "./fixtures/database";

const database = await useTestDatabase();
const { sweepStaleRuns } = await import("../src/pipeline/stale-runs");

const NOW = new Date("2026-10-08T12:00:00Z");

beforeEach(async () => {
  await database.sql`truncate pipeline_runs cascade`;
});

const insert = (status: string, startedAt: string) =>
  database.sql`insert into pipeline_runs (run_date, status, started_at) values ('2026-10-07', ${status}, ${startedAt}) returning id`
    .then((rows: { id: string }[]) => rows[0].id);

const rowOf = async (id: string) => (await database.sql`select status, failed_step, completed_at, duration_ms, step_errors from pipeline_runs where id = ${id}`)[0];

describe("sweepStaleRuns", () => {
  test("closes a run left running for more than six hours as abandoned", async () => {
    const id = await insert("running", "2026-10-07T05:00:00Z");
    expect(await sweepStaleRuns(NOW)).toBe(1);

    const row = await rowOf(id);
    expect(row.status).toBe("failed");
    expect(row.failed_step).toBe("abandoned");
    expect(row.completed_at).not.toBeNull();
    expect(Number(row.duration_ms)).toBe(31 * 3_600_000);
    expect(row.step_errors[0].step).toBe("abandoned");
  });

  test("leaves a recent running run, and finished runs, alone", async () => {
    const recent = await insert("running", "2026-10-08T09:00:00Z");
    const done = await insert("completed", "2026-10-06T05:00:00Z");
    const failed = await insert("failed", "2026-10-06T05:00:00Z");
    expect(await sweepStaleRuns(NOW)).toBe(0);

    expect((await rowOf(recent)).status).toBe("running");
    expect((await rowOf(done)).status).toBe("completed");
    expect((await rowOf(failed)).failed_step).toBeNull();
  });
});

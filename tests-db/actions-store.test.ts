// src/actions/store.ts against real SQL: the claim that makes a double tap run a skill once, the
// status transitions, and a re-run replacing only unresolved proposals. The skill gate
// (`executeSkill`) and the calendar zone lookup are the only mocks.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { useTestDatabase } from "./fixtures/database";

type Outcome = { status: string; message: string; executionId?: string };
let outcome: Outcome = { status: "executed", message: "Added to the calendar" };
let gate: Promise<void> | null = null;
const calls: { skill: string; parameters: Record<string, unknown>; triggeredBy: string; options: Record<string, unknown> }[] = [];

mock.module("../src/skills/execute", () => ({
  executeSkill: async (skill: string, parameters: Record<string, unknown>, triggeredBy: string, options: Record<string, unknown>) => {
    calls.push({ skill, parameters, triggeredBy, options });
    if (gate) await gate;
    return outcome;
  },
}));
mock.module("../src/ingest/google", () => ({ calendarTimeZone: async () => "Europe/Zurich", listCalendarEvents: async () => [] }));

const database = await useTestDatabase();
const { db, reportActions, skillExecutions } = await import("../src/db");
const store = await import("../src/actions/store");

const DAY = "2026-10-05";
const MISSING = "00000000-0000-4000-8000-000000000000";

beforeEach(async () => {
  outcome = { status: "executed", message: "Added to the calendar" };
  gate = null;
  calls.length = 0;
  await database.sql`truncate report_actions, skill_executions cascade`;
});

async function seed(over: Partial<typeof reportActions.$inferInsert> = {}) {
  const [row] = await db
    .insert(reportActions)
    .values({
      runDate: DAY,
      kind: "add_todo",
      skillName: "add_todo_item",
      parameters: { title: "Call the bank" },
      preview: { kind: "add_todo", title: "Call the bank", due: null, notes: null },
      sourceExtractionIds: [],
      ...over,
    })
    .returning();
  return row!;
}

function proposal(title: string, over: Record<string, unknown> = {}) {
  return {
    kind: "add_todo" as const,
    skillName: "add_todo_item",
    parameters: { title },
    preview: { kind: "add_todo" as const, title, due: null, notes: null },
    reason: "from a mail",
    sourceExtractionIds: [],
    discarded: null,
    ...over,
  };
}

const rows = async (day = DAY) => (await db.select().from(reportActions)).filter((r) => r.runDate === day);
const statusOf = async (id: string) => (await db.select().from(reportActions)).find((r) => r.id === id)?.status;

describe("saveProposals", () => {
  test("stores offered proposals as proposed and thrown-out ones as discarded with the reason", async () => {
    await store.saveProposals(DAY, [proposal("Pay the invoice"), proposal("Book the room", { discarded: "bad_time" })]);
    const saved = (await db.select().from(reportActions)).sort((a, b) => a.status.localeCompare(b.status));
    expect(saved.map((r) => [r.status, r.statusDetail])).toEqual([["discarded", "bad_time"], ["proposed", null]]);
  });

  test("a re-run replaces proposed, failed and discarded rows and keeps what the reader acted on", async () => {
    const done = await seed({ status: "done", parameters: { title: "Done thing" }, preview: { kind: "add_todo", title: "Done thing", due: null, notes: null } });
    const dismissed = await seed({ status: "dismissed" });
    const queued = await seed({ status: "queued" });
    const running = await seed({ status: "running" });
    const stale = [await seed({ status: "proposed" }), await seed({ status: "failed" }), await seed({ status: "discarded", statusDetail: "bad_time" })];

    await store.saveProposals(DAY, [proposal("Something new entirely")]);

    const left = new Set((await db.select().from(reportActions)).map((r) => r.id));
    for (const keep of [done, dismissed, queued, running]) expect(left.has(keep.id)).toBe(true);
    for (const gone of stale) expect(left.has(gone.id)).toBe(false);
    expect(left.size).toBe(5);
  });

  test("a new proposal for what is already done or dismissed is discarded as already_handled", async () => {
    await seed({ status: "done", parameters: { title: "Renew the passport" }, preview: { kind: "add_todo", title: "Renew the passport", due: null, notes: null } });
    await seed({ status: "dismissed", parameters: { title: "Water the plants" }, preview: { kind: "add_todo", title: "Water the plants", due: null, notes: null } });

    await store.saveProposals(DAY, [proposal("Renew passport"), proposal("Water the plants today"), proposal("Pick up the parcel")]);

    const fresh = (await db.select().from(reportActions)).filter((r) => r.status === "discarded" || r.status === "proposed");
    expect(fresh.map((r) => [r.preview.kind === "add_todo" ? r.preview.title : "", r.status, r.statusDetail]).sort()).toEqual([
      ["Pick up the parcel", "proposed", null],
      ["Renew passport", "discarded", "already_handled"],
      ["Water the plants today", "discarded", "already_handled"],
    ]);
  });

  test("is idempotent, scoped to its date, and an empty list still clears the unresolved rows", async () => {
    await seed({ runDate: "2026-10-04" });
    await store.saveProposals(DAY, [proposal("One"), proposal("Two")]);
    await store.saveProposals(DAY, [proposal("One"), proposal("Two")]);
    expect(await rows(DAY)).toHaveLength(2);
    expect(await rows("2026-10-04")).toHaveLength(1);

    await store.saveProposals(DAY, []);
    expect(await rows(DAY)).toHaveLength(0);
    expect(await rows("2026-10-04")).toHaveLength(1);
  });
});

describe("runAction", () => {
  test("runs the skill as a quick action with the row's parameters and records the outcome", async () => {
    const [execution] = await db.insert(skillExecutions).values({ runDate: DAY, skillName: "add_todo_item", parameters: {}, status: "executed", triggeredBy: "quick_action" }).returning();
    outcome = { status: "executed", message: "Added: Call the bank", executionId: execution!.id };
    const action = await seed();

    const result = await store.runAction(action.id);

    expect(result.message).toBe("Added: Call the bank");
    expect(result.action).toMatchObject({ status: "done", statusDetail: "Added: Call the bank", skillExecutionId: execution!.id });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ skill: "add_todo_item", parameters: { title: "Call the bank" }, triggeredBy: "quick_action", options: { runDate: DAY, actor: "user", timeZone: "Europe/Zurich" } });
  });

  test("a skill parked for approval is queued and a failing one is failed, and failed can be retried", async () => {
    const parked = await seed();
    outcome = { status: "pending_confirmation", message: "Waiting for approval" };
    expect((await store.runAction(parked.id)).action.status).toBe("queued");

    const broken = await seed();
    outcome = { status: "failed", message: "Calendar said no" };
    expect((await store.runAction(broken.id)).action).toMatchObject({ status: "failed", statusDetail: "Calendar said no" });

    outcome = { status: "executed", message: "Added after retry" };
    expect((await store.runAction(broken.id)).action.status).toBe("done");
  });

  test("a double tap runs the skill once: the loser is told the action is already running", async () => {
    let release!: () => void;
    gate = new Promise((resolve) => (release = resolve));
    const action = await seed();

    const first = store.runAction(action.id);
    try {
      await Bun.sleep(50);
      // A second claim that wrongly succeeds would wait on the gate too, so race it against a timeout.
      const second = Promise.race([store.runAction(action.id), Bun.sleep(1000).then(() => "claimed twice")]);
      await expect(second).rejects.toMatchObject({ kind: "conflict", message: "This action is already running." });
    } finally {
      release();
    }
    expect((await first).action.status).toBe("done");
    expect(calls).toHaveLength(1);
  });

  test("tapping a done action answers with what it did instead of running it again", async () => {
    const done = await seed({ status: "done", statusDetail: "Added earlier" });
    expect((await store.runAction(done.id)).message).toBe("Added earlier");
    expect(calls).toHaveLength(0);
  });

  test("a running claim older than two minutes is taken over, a fresh one is not", async () => {
    const lost = await seed({ status: "running" });
    const fresh = await seed({ status: "running" });
    await database.sql`update report_actions set updated_at = now() - interval '3 minutes' where id = ${lost.id}`;

    await expect(store.runAction(fresh.id)).rejects.toMatchObject({ kind: "conflict" });
    expect((await store.runAction(lost.id)).action.status).toBe("done");
    expect(calls).toHaveLength(1);
  });

  test("dismissed and queued actions conflict, discarded or unknown ones do not exist", async () => {
    const dismissed = await seed({ status: "dismissed" });
    const queued = await seed({ status: "queued" });
    const discarded = await seed({ status: "discarded", statusDetail: "bad_time" });
    await expect(store.runAction(dismissed.id)).rejects.toMatchObject({ kind: "conflict", message: "This action is dismissed." });
    await expect(store.runAction(queued.id)).rejects.toMatchObject({ kind: "conflict", message: "This action is queued." });
    await expect(store.runAction(discarded.id)).rejects.toMatchObject({ kind: "not_found", status: 404 });
    await expect(store.runAction(MISSING)).rejects.toMatchObject({ kind: "not_found" });
    expect(calls).toHaveLength(0);
  });
});

describe("dismissAction and restoreAction", () => {
  test("dismiss hides a proposed or failed action and restore brings it back as proposed", async () => {
    for (const status of ["proposed", "failed"]) {
      const action = await seed({ status });
      expect((await store.dismissAction(action.id)).status).toBe("dismissed");
      expect((await store.restoreAction(action.id)).status).toBe("proposed");
    }
  });

  test("repeating either is harmless, but a resolved action cannot be dismissed", async () => {
    const action = await seed();
    await store.dismissAction(action.id);
    expect((await store.dismissAction(action.id)).status).toBe("dismissed");
    await store.restoreAction(action.id);
    expect((await store.restoreAction(action.id)).status).toBe("proposed");

    for (const status of ["done", "running", "queued"]) {
      const resolved = await seed({ status });
      await expect(store.dismissAction(resolved.id)).rejects.toMatchObject({ kind: "conflict", message: `This action is ${status}.` });
      expect(await statusOf(resolved.id)).toBe(status);
    }
  });

  test("a discarded or unknown action does not exist", async () => {
    const discarded = await seed({ status: "discarded", statusDetail: "daily_cap" });
    await expect(store.dismissAction(discarded.id)).rejects.toMatchObject({ kind: "not_found" });
    await expect(store.restoreAction(MISSING)).rejects.toMatchObject({ kind: "not_found" });
  });
});

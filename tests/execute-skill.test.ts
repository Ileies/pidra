// Protects the one gate every skill call passes through (docs/skills.md): unknown, disabled, surface,
// then risk level (critical never runs, high parks as pending), and the re-checks when a parked call
// is confirmed. Every outcome must land on the audit row. The db, the registry and the owner's
// on/off switches are mocks; the surface allowlist is the real one.
import { beforeEach, expect, mock, spyOn, test } from "bun:test";
import { dbModule } from "./fixtures/db";
import { SURFACES } from "../src/ai/surfaces";

type Risk = "low" | "medium" | "high" | "critical";
type Ctx = { executionId: string; triggeredBy: string; actor: string; conversationId: string | null; timeZone: string };
type Audit = { id: string; skillName: string; parameters: unknown; status: string; result?: string; triggeredBy: string };

let skills = new Map<string, { name: string; risk_level: Risk; execute: (params: Record<string, unknown>, ctx: Ctx) => Promise<string> }>();
let switches: Record<string, { enabled?: boolean; risk_level?: Risk }> = {};
let audit: Audit | null = null;
let ran: { name: string; params: Record<string, unknown>; ctx: Ctx }[] = [];

function addSkill(name: string, risk: Risk, execute?: (params: Record<string, unknown>, ctx: Ctx) => Promise<string>) {
  skills.set(name, {
    name,
    risk_level: risk,
    execute: async (params, ctx) => {
      ran.push({ name, params, ctx });
      return execute ? execute(params, ctx) : `${name} done`;
    },
  });
}

const db = {
  insert: () => ({
    values: (v: Omit<Audit, "id">) => ({
      returning: async () => {
        audit = { ...v, id: "exec-1" };
        return [{ id: audit.id }];
      },
    }),
  }),
  update: () => ({
    set: (values: Partial<Audit>) => ({
      where: async () => {
        if (audit) Object.assign(audit, values);
      },
    }),
  }),
  select: () => ({ from: () => ({ where: async () => (audit ? [{ ...audit, skillName: audit.skillName }] : []) }) }),
};

mock.module("../src/db", () => dbModule(db));
mock.module("../src/skills/loader", () => ({
  getSkill: (name: string) => skills.get(name),
  listSkills: () => [...skills.values()],
}));
mock.module("../src/skills/overrides", () => ({
  getEffectiveSkill: async (name: string) => {
    const skill = skills.get(name);
    if (!skill) return null;
    const s = switches[name] ?? {};
    return { name, risk_level: s.risk_level ?? skill.risk_level, enabled: s.enabled ?? true };
  },
}));
const { executeSkill, resolvePendingSkill } = await import("../src/skills/execute?execute-skill-test");

const onNotesOnly = SURFACES.notes.skills.find((name) => !SURFACES.questions.skills.includes(name))!;
const onQuestions = SURFACES.questions.skills[0];

beforeEach(() => {
  skills = new Map();
  switches = {};
  audit = null;
  ran = [];
});

test("an unknown skill is reported without writing an audit row", async () => {
  const out = await executeSkill("nope", {}, "manual");
  expect(out.status).toBe("unknown_skill");
  expect(audit).toBeNull();
});

test("a low-risk skill runs, passes its parameters and context, and settles the audit row as executed", async () => {
  addSkill("low_skill", "low");
  const out = await executeSkill("low_skill", { a: 1 }, "manual");

  expect(out).toEqual({ status: "executed", message: "low_skill done", executionId: "exec-1" });
  expect(ran).toHaveLength(1);
  expect(ran[0].params).toEqual({ a: 1 });
  expect(ran[0].ctx).toMatchObject({ executionId: "exec-1", triggeredBy: "manual", actor: "system", conversationId: null, timeZone: "UTC" });
  expect(audit).toMatchObject({ status: "executed", result: "low_skill done", skillName: "low_skill", parameters: { a: 1 } });
});

test("a medium-risk skill runs and is logged", async () => {
  addSkill("medium_skill", "medium");
  const log = spyOn(console, "log").mockImplementation(() => {});
  try {
    const out = await executeSkill("medium_skill", {}, "manual");
    expect(out.status).toBe("executed");
    expect(log.mock.calls.some((c) => String(c[0]).includes("Medium-risk skill executed: medium_skill"))).toBe(true);
  } finally {
    log.mockRestore();
  }
});

test("a chat call is attributed to the chat, an explicit actor wins, other triggers are the system", async () => {
  addSkill("low_skill", "low");
  await executeSkill("low_skill", {}, "chat", { conversationId: "c-1" });
  await executeSkill("low_skill", {}, "report_section");
  await executeSkill("low_skill", {}, "quick_action", { actor: "user" });

  expect(ran.map((r) => r.ctx.actor)).toEqual(["chat", "system", "user"]);
  expect(ran[0].ctx.conversationId).toBe("c-1");
});

test("a high-risk skill is parked as pending_confirmation and does not run", async () => {
  addSkill("high_skill", "high");
  const out = await executeSkill("high_skill", {}, "chat");

  expect(out.status).toBe("pending_confirmation");
  expect(out.executionId).toBe("exec-1");
  expect(ran).toHaveLength(0);
  expect(audit?.status).toBe("pending");
});

test("a critical skill never runs, and the rejection is on the audit row", async () => {
  addSkill("critical_skill", "critical");
  const out = await executeSkill("critical_skill", {}, "manual");

  expect(out.status).toBe("rejected");
  expect(out.message).toContain("critical");
  expect(ran).toHaveLength(0);
  expect(audit).toMatchObject({ status: "rejected", result: out.message });
});

test("a skill the owner has raised to critical on /skills is gated by the effective level, not the code's", async () => {
  addSkill("low_skill", "low");
  switches.low_skill = { risk_level: "critical" };
  const out = await executeSkill("low_skill", {}, "manual");

  expect(out.status).toBe("rejected");
  expect(ran).toHaveLength(0);
});

test("a disabled skill is rejected with the reason recorded, whatever its risk level", async () => {
  for (const risk of ["low", "high", "critical"] as const) {
    skills = new Map();
    ran = [];
    addSkill("off_skill", risk);
    switches.off_skill = { enabled: false };
    const out = await executeSkill("off_skill", {}, "manual");

    expect(out.status).toBe("rejected");
    expect(out.message).toBe("off_skill is disabled");
    expect(audit).toMatchObject({ status: "rejected", result: "off_skill is disabled" });
    expect(ran).toHaveLength(0);
  }
});

test("a skill outside the calling page's allowlist is rejected and logged, ahead of the risk gate", async () => {
  addSkill(onNotesOnly, "high");
  const out = await executeSkill(onNotesOnly, {}, "chat", { surface: "questions" });

  expect(out.status).toBe("rejected");
  expect(out.message).toContain("is not available on the questions page");
  expect(audit?.status).toBe("rejected");
  expect(ran).toHaveLength(0);
});

test("a skill on the calling page's allowlist runs, and with no surface given nothing is filtered", async () => {
  addSkill(onQuestions, "low");
  addSkill(onNotesOnly, "low");

  expect((await executeSkill(onQuestions, {}, "chat", { surface: "questions" })).status).toBe("executed");
  expect((await executeSkill(onNotesOnly, {}, "chat")).status).toBe("executed");
  expect((await executeSkill(onNotesOnly, {}, "chat", { surface: "notes" })).status).toBe("executed");
});

test("a skill that throws is a failed outcome with the message on the audit row, not an exception", async () => {
  addSkill("broken_skill", "low", async () => {
    throw new Error("calendar said no");
  });
  const out = await executeSkill("broken_skill", {}, "manual");

  expect(out).toEqual({ status: "failed", message: "calendar said no", executionId: "exec-1" });
  expect(audit).toMatchObject({ status: "failed", result: "calendar said no" });
});

async function parkHighRisk() {
  addSkill("high_skill", "high");
  await executeSkill("high_skill", { x: 2 }, "chat");
}

test("confirming a parked call runs it as the owner with the parameters it was queued with", async () => {
  await parkHighRisk();
  const out = await resolvePendingSkill("exec-1", "confirm");

  expect(out.status).toBe("executed");
  expect(ran).toHaveLength(1);
  expect(ran[0].params).toEqual({ x: 2 });
  expect(ran[0].ctx).toMatchObject({ actor: "user", conversationId: null, triggeredBy: "chat" });
  expect(audit?.status).toBe("executed");
});

test("rejecting a parked call records the reason, or a default, and does not run it", async () => {
  await parkHighRisk();
  const out = await resolvePendingSkill("exec-1", "reject", "  not now  ");
  expect(out).toMatchObject({ status: "rejected", message: "not now" });
  expect(audit).toMatchObject({ status: "rejected", result: "not now" });

  audit = { ...audit!, status: "pending" };
  const dflt = await resolvePendingSkill("exec-1", "reject", "   ");
  expect(dflt.message).toBe("Rejected by the owner");
  expect(ran).toHaveLength(0);
});

test("a parked call can be resolved once: confirming it twice runs it once and rejects the repeat", async () => {
  await parkHighRisk();
  await resolvePendingSkill("exec-1", "confirm");
  const again = await resolvePendingSkill("exec-1", "confirm");

  expect(again.status).toBe("rejected");
  expect(again.message).toContain("already executed");
  expect(ran).toHaveLength(1);
});

test("confirming an execution that does not exist is reported, not run", async () => {
  const out = await resolvePendingSkill("missing", "confirm");
  expect(out.status).toBe("unknown_skill");
  expect(ran).toHaveLength(0);
});

test("confirmation re-checks the switches: disabled or raised to critical since queueing means it does not run", async () => {
  await parkHighRisk();
  switches.high_skill = { enabled: false };
  const disabled = await resolvePendingSkill("exec-1", "confirm");
  expect(disabled.status).toBe("rejected");
  expect(disabled.message).toContain("disabled since this call was queued");

  audit = { ...audit!, status: "pending" };
  switches.high_skill = { risk_level: "critical" };
  const critical = await resolvePendingSkill("exec-1", "confirm");
  expect(critical.status).toBe("rejected");
  expect(critical.message).toContain("now critical");
  expect(ran).toHaveLength(0);
});

test("confirming a call whose skill has since been removed fails the audit row", async () => {
  await parkHighRisk();
  skills.delete("high_skill");
  const out = await resolvePendingSkill("exec-1", "confirm");

  expect(out.status).toBe("unknown_skill");
  expect(audit?.status).toBe("failed");
});

// Load tracking (src/notes/loads.ts) and the targeting filters of listNotes, against real SQL.
import { beforeEach, describe, expect, test } from "bun:test";
import { useTestDatabase } from "./fixtures/database";

const database = await useTestDatabase();
const store = await import("../src/notes/store");
const { selectNotes } = await import("../src/notes/select");
const { loadStatsFor, recordLoads } = await import("../src/notes/loads");

const USER = { by: "user" } as const;

beforeEach(async () => {
  await database.sql`truncate notes cascade`;
});

const days = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

describe("recording loads", () => {
  test("selectNotes records what it returned, once per note, step and day", async () => {
    const plain = await store.createNote({ content: "plain", scope: "personal" }, USER);
    const targeted = await store.createNote({ content: "netcup", scope: "personal", appliesTo: { senders: ["netcup"] } }, USER);

    await selectNotes("section2", "2030-06-15");
    await selectNotes("section2", "2030-06-15");
    await selectNotes("section2", "2030-06-16");

    const stats = await loadStatsFor([plain.id, targeted.id]);
    expect(stats.get(plain.id)).toEqual({ count: 2, last: "2030-06-16" });
    // Section 2 has no item, so the targeted note never loaded and never counts.
    expect(stats.has(targeted.id)).toBe(false);

    await selectNotes("classify", "2030-06-16", { sender: "billing@netcup.example", text: "invoice" });
    expect((await loadStatsFor([targeted.id])).get(targeted.id)).toEqual({ count: 1, last: "2030-06-16" });
    expect((await loadStatsFor([plain.id])).get(plain.id)).toEqual({ count: 3, last: "2030-06-16" });
  });

  test("a different step on the same day counts separately", async () => {
    const note = await store.createNote({ content: "both", scope: "personal" }, USER);
    await recordLoads("classify", "2030-06-15", [note]);
    await recordLoads("actions", "2030-06-15", [note]);
    expect((await loadStatsFor([note.id])).get(note.id)?.count).toBe(2);
  });

  test("a failed write is swallowed, so a stage never fails on bookkeeping", async () => {
    await recordLoads("classify", "2030-06-15", [{ id: "00000000-0000-0000-0000-000000000000" }]);
    await recordLoads("classify", "2030-06-15", []);
  });

  test("a hard delete of the note takes its loads with it", async () => {
    const note = await store.createNote({ content: "gone", scope: "personal" }, USER);
    await recordLoads("classify", "2030-06-15", [note]);
    await database.sql`delete from notes where id = ${note.id}`;
    const [row] = await database.sql`select count(*)::int as n from note_loads`;
    expect(row.n).toBe(0);
  });
});

describe("listNotes targeting filters", () => {
  const ids = async (opts: Parameters<typeof store.listNotes>[0]) => (await store.listNotes(opts)).map((n) => n.content).sort();

  beforeEach(async () => {
    await store.createNote({ content: "always", scope: "global" }, USER);
    await store.createNote({ content: "step", scope: "personal", steps: ["classify"] }, USER);
    await store.createNote({ content: "targeted", scope: "personal", steps: ["classify"], appliesTo: { senders: ["Netcup"], keywords: ["invoice"] } }, USER);
    await store.createNote({ content: "dated", scope: "global", expiresAt: "2099-01-01" }, USER);
    await store.createNote({ content: `${(await import("../src/notes/select")).PROPOSAL_PREFIX} x`, scope: "global" }, USER);
  });

  test("narrowness mirrors the dashboard's derived kinds", async () => {
    expect(await ids({ narrowness: "always" })).toEqual(expect.arrayContaining(["always", "dated"]));
    expect(await ids({ narrowness: "step" })).toEqual(["step"]);
    expect(await ids({ narrowness: "targeted" })).toEqual(["targeted"]);
    expect(await ids({ narrowness: "dated" })).toEqual(["dated"]);
    await expect(store.listNotes({ narrowness: "sideways" })).rejects.toThrow(/narrowness must be one of/);
  });

  test("step lists what the step can read, never the meta-run proposal", async () => {
    expect(await ids({ step: "classify" })).toEqual(["always", "dated", "step", "targeted"]);
    expect(await ids({ step: "section1" })).toEqual(["always", "dated"]);
    expect(await ids({ step: "news" })).toEqual([]);
    await expect(store.listNotes({ step: "lunch" })).rejects.toThrow(/step must be one of/);
  });

  test("target is a case-insensitive substring over every targeted sender, entity and keyword", async () => {
    expect(await ids({ target: "netc" })).toEqual(["targeted"]);
    expect(await ids({ target: "INVOICE" })).toEqual(["targeted"]);
    expect(await ids({ target: "senders" })).toEqual([]);
    expect(await ids({ target: "%" })).toEqual([]);
  });

  test("dormant keeps the notes with no load in the last 30 days", async () => {
    const all = await store.listNotes({});
    const byContent = (c: string) => all.find((n) => n.content === c)!;
    await recordLoads("classify", days(2), [byContent("step")]);
    await recordLoads("classify", days(40), [byContent("targeted")]);

    const dormant = await ids({ dormant: true });
    expect(dormant).not.toContain("step");
    expect(dormant).toEqual(expect.arrayContaining(["always", "targeted", "dated"]));
  });
});

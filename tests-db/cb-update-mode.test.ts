// The Context Builder's update-mode merge against real SQL: context-builder/phases/synthesize.ts
// (what each summary is built from, what the patch call is told, the rebuild when the patch breaks
// the heading contract) and the run-tracking loaders it reads (previous document, stored corpus,
// mode detection). Only the model call and the tracked error log are stubs.
import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { useTestDatabase } from "./fixtures/database";

type Any = Record<string, any>;
type Call = { kind: string; system: string; payload: Any | null; raw: string };
const calls: Call[] = [];
const logged: { source: string; message: string }[] = [];
const model = { patch: "" as string, full: "" as string, failKind: null as string | null };

const GOOD = ["# 1. Identity", "a", "# 2. Projects", "b", "# 3. Knowledge", "c", "# 4. Standing", "d", "# 5. Technical", "e"].join("\n");
const KINDS: [string, string][] = [
  ["You are building a contact directory", "contacts"], ["Summarize these Google Tasks", "tasks"], ["Summarize these Google Keep", "keep"],
  ["Summarize these GitHub", "github"], ["You are building a long-term", "full"], ["Update this existing personal context", "patch"],
];

mock.module("../src/ai/openai", () => ({
  synthesize: async (system: string, user: string) => {
    const kind = KINDS.find(([prefix]) => system.startsWith(prefix))![1];
    let payload: Any | null = null;
    try { payload = JSON.parse(user); } catch { /* the contact list is a bare array, still JSON; anything else stays raw */ }
    calls.push({ kind, system, payload, raw: user });
    if (model.failKind === kind) throw new Error(`${kind} model down`);
    return { text: kind === "patch" ? model.patch : kind === "full" ? model.full : `${kind.toUpperCase()} SUMMARY` };
  },
}));
mock.module("../context-builder/errors", () => ({
  logError: async (source: string, error: unknown) => { logged.push({ source, message: error instanceof Error ? error.message : String(error) }); },
  loadErrors: async () => [],
  getErrors: () => [],
}));

const database = await useTestDatabase();
const { synthesizePhase } = await import("../context-builder/phases/synthesize");
const { detectMode, getSkipSet, getResumableRun, loadPreviousDocument, loadStoredExtractions } = await import("../context-builder/run-tracking");

const mail = (messageId: string, from = "anna@example.com"): Any => ({
  messageId, from, fromName: "Anna", date: "2026-09-10T08:00:00Z", category: "work", importance: "high", summary: "s", actionRequired: null, entities: [], sentiment: "neutral",
});
const note = (id: string): Any => ({ id, title: "", labels: [], category: "rules", summary: "", entities: [], type: "note", importance: "high", rawText: "" });
const task = (id: string): Any => ({ id, listId: "l", listTitle: "Home", title: "Pay rent", notes: null, due: null, status: "needsAction", completedAt: null });
const repo = (name: string): Any => ({ id: `me/${name}`, name, description: null, language: "TypeScript", pushedAt: null, readme: null, recentCommits: [], isPrivate: false });

const store = (source: string, itemId: string, data: Any | null) =>
  database.sql`insert into context_builder_indexed_items (source, item_id, data) values (${source}, ${itemId}, ${data === null ? null : JSON.stringify(data)}::text::jsonb)`;
const run = (status: string, over: { document?: string | null; items?: number; startedAt: string }) =>
  database.sql`insert into context_builder_runs (mode, status, started_at, items_indexed, document) values ('update', ${status}, ${over.startedAt}, ${over.items ?? 0}, ${over.document === undefined || over.document === null ? null : JSON.stringify({ fullContext: over.document })}::text::jsonb)`;

const state = () => ({ phases: { synthesis: { done: false } } }) as Any;
const phase = (mode: "full" | "update", fetched: { taskItems?: Any[]; githubRepos?: Any[] }, extracted: { emails?: Any[]; notes?: Any[] } = {}) => {
  const s = state();
  const done = synthesizePhase(
    { mode, state: s, config: {}, dbRunId: undefined, today: "2026-10-06", fromIndex: false } as never,
    { taskItems: fetched.taskItems ?? [], githubRepos: fetched.githubRepos ?? [] } as never,
    { emailExtractions: extracted.emails ?? [], noteExtractions: extracted.notes ?? [] } as never,
  );
  return { s, done };
};
const callsOf = (kind: string) => calls.filter((c) => c.kind === kind);

beforeEach(async () => {
  await database.sql`truncate context_builder_indexed_items, context_builder_runs, context_corrections cascade`;
  calls.length = 0;
  logged.length = 0;
  Object.assign(model, { patch: `${GOOD}\npatched`, full: `${GOOD}\nrebuilt`, failKind: null });
  spyOn(console, "log").mockImplementation(() => {});
  spyOn(console, "warn").mockImplementation(() => {});
});

describe("a full build", () => {
  test("summarises the sources fetched this run and builds the document from them, with no patch", async () => {
    const { s, done } = phase("full", { taskItems: [task("t1")], githubRepos: [repo("r1")] }, { emails: [mail("m1")], notes: [note("n1")] });
    const { parts, fullContext } = await done;

    expect(parts).toEqual({ contacts: "CONTACTS SUMMARY", tasks: "TASKS SUMMARY", keep: "KEEP SUMMARY", github: "GITHUB SUMMARY" });
    expect(fullContext).toBe(`${GOOD}\nrebuilt`);
    expect(callsOf("patch")).toEqual([]);
    expect(callsOf("full")[0]!.payload).toMatchObject(parts);
    expect(s.phases.synthesis.done).toBe(true);
  });

  test("a source that produced nothing gets a placeholder summary, without a model call", async () => {
    const { parts } = await phase("full", {}, { emails: [mail("m1")] }).done;
    expect(parts).toEqual({ contacts: "CONTACTS SUMMARY", tasks: "No task data", keep: "No Keep data", github: "No GitHub data" });
    expect(calls.map((c) => c.kind).sort()).toEqual(["contacts", "full"]);
  });

  test("the stored corpus is not consulted: only this run's extractions are summarised", async () => {
    await store("email", "old1", mail("old1", "old@example.com"));
    await phase("full", {}, { emails: [mail("m1", "new@example.com")] }).done;
    expect(callsOf("contacts")[0]!.payload!.map((c: Any) => c.email)).toEqual(["new@example.com"]);
  });
});

describe("update mode", () => {
  test("the contact and Keep summaries come from the whole stored corpus, not just the delta", async () => {
    await store("email", "old1", mail("old1", "old@example.com"));
    await store("email", "m1", mail("m1", "new@example.com"));
    await store("keep", "k1", note("k1"));
    await store("keep", "k2", note("k2"));
    await store("email", "no-data", null);
    await run("completed", { document: GOOD, items: 40, startedAt: "2026-09-01T00:00:00Z" });

    await phase("update", {}, { emails: [mail("m1", "new@example.com")] }).done;

    expect(callsOf("contacts")[0]!.payload!.map((c: Any) => c.email).sort()).toEqual(["new@example.com", "old@example.com"]);
    expect(Object.values(callsOf("keep")[0]!.payload!).flat()).toHaveLength(2);
  });

  test("the patch gets the previous document, both item counts and only the sources that produced something", async () => {
    await store("email", "m1", mail("m1"));
    await run("completed", { document: GOOD, items: 40, startedAt: "2026-09-01T00:00:00Z" });

    const { parts, fullContext } = await phase("update", { githubRepos: [repo("r1"), repo("r2")] }, { emails: [mail("m1")], notes: [note("n1")] }).done;

    expect(fullContext).toBe(`${GOOD}\npatched`);
    expect(callsOf("full")).toEqual([]);
    const [patch] = callsOf("patch");
    expect(patch!.system).toContain("reflects 40 previously indexed items");
    expect(patch!.system).toContain("The delta contains 4 new items");
    expect(patch!.payload!.existing_context).toBe(GOOD);
    expect(Object.keys(patch!.payload!.delta).sort()).toEqual(["contacts", "github"]);
    expect(patch!.payload!.delta).toEqual({ contacts: parts.contacts, github: parts.github });
  });

  test("tasks are fetched in full every run, so they are in the delta but not in its item count", async () => {
    await run("completed", { document: GOOD, items: 5, startedAt: "2026-09-01T00:00:00Z" });
    await phase("update", { taskItems: [task("t1"), task("t2"), task("t3")], githubRepos: [repo("r1")] }).done;
    expect(callsOf("patch")[0]!.system).toContain("The delta contains 1 new items");
    expect(Object.keys(callsOf("patch")[0]!.payload!.delta).sort()).toEqual(["github", "tasks"]);
  });

  test("a run with no new mail still summarises the stored contacts: the delta says what the corpus holds", async () => {
    await store("email", "old1", mail("old1", "old@example.com"));
    await run("completed", { document: GOOD, items: 5, startedAt: "2026-09-01T00:00:00Z" });
    await phase("update", { githubRepos: [repo("r1")] }).done;
    expect(callsOf("contacts")[0]!.payload!.map((c: Any) => c.email)).toEqual(["old@example.com"]);
    expect(callsOf("patch")[0]!.system).toContain("The delta contains 1 new items");
    expect(Object.keys(callsOf("patch")[0]!.payload!.delta).sort()).toEqual(["contacts", "github"]);
  });

  test("a summary that failed is left out of the delta instead of being sent empty", async () => {
    await run("completed", { document: GOOD, items: 5, startedAt: "2026-09-01T00:00:00Z" });
    model.failKind = "tasks";
    await phase("update", { taskItems: [task("t1")], githubRepos: [repo("r1")] }).done;
    expect(callsOf("patch")[0]!.payload!.delta).toEqual({ github: "GITHUB SUMMARY" });
  });

  test("a source that was not fetched is absent from the delta, not a placeholder that reads as gone", async () => {
    await run("completed", { document: GOOD, items: 5, startedAt: "2026-09-01T00:00:00Z" });
    await phase("update", { taskItems: [task("t1")] }).done;
    expect(callsOf("patch")[0]!.payload!.delta).toEqual({ tasks: "TASKS SUMMARY" });
  });

  test("without a previous document that parses, the document is built in full", async () => {
    await run("completed", { document: "# Updated Personal Context\n## 1. Topics", items: 9, startedAt: "2026-09-01T00:00:00Z" });
    await store("email", "m1", mail("m1"));
    const { fullContext } = await phase("update", {}, { emails: [mail("m1")] }).done;
    expect(fullContext).toBe(`${GOOD}\nrebuilt`);
    expect(callsOf("patch")).toEqual([]);
  });

  test("a patch that lost the headings is rebuilt in full, and the rejection is logged under the phase", async () => {
    await run("completed", { document: GOOD, items: 9, startedAt: "2026-09-01T00:00:00Z" });
    model.patch = "# Updated Personal Context\n## 1. Topics that changed";
    const { fullContext } = await phase("update", { taskItems: [task("t1")] }).done;
    expect(fullContext).toBe(`${GOOD}\nrebuilt`);
    expect(logged).toEqual([{ source: "phase:synthesis", message: "patched document is missing section(s) 1, 2, 3, 4, 5 - rebuilding it in full instead" }]);
  });

  test("when the rebuild fails the contract too, no document is recorded but the summaries are kept", async () => {
    await run("completed", { document: GOOD, items: 9, startedAt: "2026-09-01T00:00:00Z" });
    model.patch = "nothing useful";
    model.full = "still nothing";
    const { s, done } = phase("update", { taskItems: [task("t1")] });
    const { parts, fullContext } = await done;
    expect(fullContext).toBe("");
    expect(parts.tasks).toBe("TASKS SUMMARY");
    expect(logged.map((l) => l.message)).toEqual([expect.stringContaining("patched document is missing"), "synthesised document is missing section(s) 1, 2, 3, 4, 5"]);
    expect(s.phases.synthesis.done).toBe(true);
  });

  test("a failing patch call leaves no document and does not fall back to a rebuild", async () => {
    await run("completed", { document: GOOD, items: 9, startedAt: "2026-09-01T00:00:00Z" });
    model.failKind = "patch";
    const { fullContext } = await phase("update", { taskItems: [task("t1")] }).done;
    expect(fullContext).toBe("");
    expect(callsOf("full")).toEqual([]);
    expect(logged).toEqual([{ source: "phase:synthesis", message: "patch model down" }]);
  });

  test("whichever summary fails is empty and the rest still go through", async () => {
    const all = [mail("m1")], some = { taskItems: [task("t1")], githubRepos: [repo("r1")] };
    for (const kind of ["contacts", "tasks", "keep", "github"] as const) {
      model.failKind = kind;
      const { parts, fullContext } = await phase("full", some, { emails: all, notes: [note("n1")] }).done;
      expect(Object.entries(parts).filter(([, text]) => text === "").map(([key]) => key)).toEqual([kind]);
      expect(fullContext).toBe(`${GOOD}\nrebuilt`);
    }
  });

  test("active corrections reach the patch, reverted ones do not", async () => {
    await run("completed", { document: GOOD, items: 9, startedAt: "2026-09-01T00:00:00Z" });
    await database.sql`insert into context_corrections (target_kind, target_key, operation, statement, supersedes_text) values ('document', 'Identity', 'amend', 'I live in Bern.', 'I live in Zurich.')`;
    await database.sql`insert into context_corrections (target_kind, target_key, operation, statement, status) values ('document', 'Identity', 'amend', 'Reverted claim.', 'reverted')`;
    await phase("update", { taskItems: [task("t1")] }).done;
    const expected = [{ about: "document:Identity", operation: "amend", correct: "I live in Bern.", incorrect: "I live in Zurich." }];
    expect(callsOf("patch")[0]!.payload!.context_corrections).toEqual(expected);

    await phase("full", { taskItems: [task("t1")] }).done;
    expect(callsOf("full")[0]!.payload!.context_corrections).toEqual(expected);
  });
});

describe("the run-tracking loaders", () => {
  test("the previous document is the newest completed one that parses; a broken or failed newer run is walked past", async () => {
    await run("completed", { document: GOOD.replace("# 3. Knowledge\nc\n", ""), items: 99, startedAt: "2026-09-03T00:00:00Z" });
    await run("failed", { document: GOOD, items: 88, startedAt: "2026-09-02T00:00:00Z" });
    await run("completed", { document: null, items: 77, startedAt: "2026-09-02T12:00:00Z" });
    await run("completed", { document: GOOD, items: 40, startedAt: "2026-09-01T00:00:00Z" });
    expect(await loadPreviousDocument()).toEqual({ context: GOOD, itemsIndexed: 40 });
  });

  test("a good document as far back as the fifth newest run is still found", async () => {
    for (let i = 0; i < 4; i++) await run("completed", { document: "broken", startedAt: `2026-09-0${i + 2}T00:00:00Z` });
    await run("completed", { document: GOOD, items: 40, startedAt: "2026-09-01T00:00:00Z" });
    expect(await loadPreviousDocument()).toEqual({ context: GOOD, itemsIndexed: 40 });
  });

  test("nothing usable within the last five runs means no previous document", async () => {
    for (let i = 0; i < 5; i++) await run("completed", { document: "broken", startedAt: `2026-09-0${i + 2}T00:00:00Z` });
    await run("completed", { document: GOOD, items: 40, startedAt: "2026-09-01T00:00:00Z" });
    expect(await loadPreviousDocument()).toEqual({ context: "", itemsIndexed: 0 });
    await database.sql`truncate context_builder_runs cascade`;
    expect(await loadPreviousDocument()).toEqual({ context: "", itemsIndexed: 0 });
  });

  test("the stored corpus is split by source and skips rows without an extraction", async () => {
    await store("email", "m1", mail("m1"));
    await store("keep", "k1", note("k1"));
    await store("tasks", "t1", task("t1"));
    await store("email", "m2", null);
    const { emails, notes } = await loadStoredExtractions();
    expect(emails).toHaveLength(1);
    expect(notes).toHaveLength(1);
    expect([emails[0]!.messageId, notes[0]!.id]).toEqual(["m1", "k1"]);
  });

  test("the skip set holds every indexed id of the source, with or without an extraction", async () => {
    await store("email", "m1", mail("m1"));
    await store("email", "m2", null);
    await store("keep", "k1", note("k1"));
    expect([...(await getSkipSet("email"))].sort()).toEqual(["m1", "m2"]);
    expect([...(await getSkipSet("github"))]).toEqual([]);
  });

  test("a plain run is a full build until one has completed; then it is an update unless forced full", async () => {
    expect(await detectMode(false, false)).toBe("full");
    expect(await detectMode(false, true)).toBe("update");
    await run("failed", { startedAt: "2026-09-01T00:00:00Z" });
    expect(await detectMode(false, false)).toBe("full");
    await run("completed", { startedAt: "2026-09-02T00:00:00Z" });
    expect(await detectMode(false, false)).toBe("update");
    expect(await detectMode(true, true)).toBe("full");
  });

  test("the newest run still marked running is the one to resume", async () => {
    expect(await getResumableRun()).toBeNull();
    await run("running", { startedAt: "2026-09-01T00:00:00Z" });
    const [{ id }] = await run("running", { startedAt: "2026-09-02T00:00:00Z" }).then(() => database.sql`select id from context_builder_runs order by started_at desc limit 1`);
    expect(await getResumableRun()).toEqual({ id, mode: "update" });
  });
});

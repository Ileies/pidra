// The /notes targeting UI's pure parts: draft <-> patch conversion, badges, the URL filter, the offline
// filter, and what a queued note write sends to the server.
import { beforeEach, describe, expect, test } from "bun:test";
import * as db from "../src/lib/offline/db.js";
import { applyOptimistic, drain } from "../src/lib/offline/intents.js";
import { filterNotes, type NotesFilter } from "../src/lib/offline/repo.js";
import { utcDay } from "../src/lib/format.js";
import { parseFilter, searchOf } from "../src/lib/notes/filterUrl.js";
import { draftTargeting, isDormant, targetingBadges, targetingPatch, targetsOf } from "../src/lib/notes/targeting.js";
import type { Draft, NoteRow } from "../src/lib/notes/api.js";
import { intent, note, ok, queue, resetDb, stubFetch } from "./offline-helpers.js";

beforeEach(resetDb);

const draftOf = (row: NoteRow, extra: Partial<Draft> = {}): Draft => ({
  content: row.content, scope: row.scope, expires: row.expires_at ?? "", ...draftTargeting(row), saving: false, error: null, ...extra,
});

describe("draft targeting", () => {
  test("comma-separated lists become applies_to, trimmed and de-duplicated, and an empty draft is null", () => {
    expect(targetsOf({ senders: " netcup, Netcup.de ,netcup", entities: "", keywords: "invoice" })).toEqual({
      senders: ["netcup", "Netcup.de"],
      keywords: ["invoice"],
    });
    expect(targetsOf({ senders: " , ", entities: "", keywords: "" })).toBeNull();
  });

  test("an untouched draft produces no patch, and only the changed targeting fields are sent", () => {
    const row = note("n1", { steps: ["classify"], applies_to: { senders: ["netcup"] }, active_from: "2030-01-01" });
    expect(targetingPatch(row, draftOf(row))).toEqual({});

    expect(targetingPatch(row, draftOf(row, { steps: ["classify", "section2"] }))).toEqual({ steps: ["classify", "section2"] });
    expect(targetingPatch(row, draftOf(row, { senders: "", keywords: "" }))).toEqual({ applies_to: null });
    expect(targetingPatch(row, draftOf(row, { activeFrom: "" }))).toEqual({ active_from: null });
  });

  test("the order steps were picked in does not make an edit", () => {
    const row = note("n1", { steps: ["section2", "classify"] });
    expect(targetingPatch(row, draftOf(row, { steps: ["classify", "section2"] }))).toEqual({});
  });
});

describe("badges and dormancy", () => {
  test("a note that loads everywhere has no badges, a narrowed one names steps, targets and start", () => {
    expect(targetingBadges(note("a"))).toEqual([]);
    const texts = targetingBadges(note("b", { steps: ["classify"], applies_to: { senders: ["netcup"], keywords: ["invoice"] }, active_from: "2030-01-01" })).map((b) => b.text);
    expect(texts).toEqual(["classify", "senders: netcup", "keywords: invoice", "from 2030-01-01"]);
  });

  test("dormant means no load on or after the cutoff 30 days back", () => {
    expect(isDormant({ last_loaded_on: null }, "2030-06-15")).toBe(true);
    expect(isDormant({ last_loaded_on: "2030-05-16" }, "2030-06-15")).toBe(false);
    expect(isDormant({ last_loaded_on: "2030-05-15" }, "2030-06-15")).toBe(true);
  });
});

describe("filter", () => {
  const all = [
    note("always", { content: "everywhere" }),
    note("step", { content: "classify only", steps: ["classify"], scope: "personal" }),
    note("targeted", { content: "netcup", scope: "personal", steps: ["classify"], applies_to: { senders: ["Netcup"] }, last_loaded_on: "2030-06-14" }),
    note("dated", { content: "dated", expires_at: "2030-12-01" }),
    note("proposal", { content: "WEEKLY META-RUN PROMPT DIFF PROPOSAL (2030-06-10): x", scope: "global" }),
  ];
  const base: NotesFilter = { scope: "", query: "", sort: "oldest", view: "active", narrowness: "", step: "", target: "", dormant: false };
  const idsOf = (patch: Partial<NotesFilter>) => filterNotes(all, { ...base, ...patch }).map((n) => n.id).sort();

  test("narrowness picks the derived kinds", () => {
    expect(idsOf({ narrowness: "always" })).toEqual(["always", "dated", "proposal"]);
    expect(idsOf({ narrowness: "step" })).toEqual(["step"]);
    expect(idsOf({ narrowness: "targeted" })).toEqual(["targeted"]);
    expect(idsOf({ narrowness: "dated" })).toEqual(["dated"]);
  });

  test("a step shows what it can read, and the meta-run proposal is read by none", () => {
    expect(idsOf({ step: "classify" })).toEqual(["always", "dated", "step", "targeted"]);
    expect(idsOf({ step: "section1" })).toEqual(["always", "dated"]);
  });

  test("target matches a named sender, entity or keyword by substring, ignoring case", () => {
    expect(idsOf({ target: "netc" })).toEqual(["targeted"]);
    expect(idsOf({ target: "nobody" })).toEqual([]);
  });

  test("dormant keeps the notes with no recent load", () => {
    const recent = utcDay(new Date(Date.now() - 86_400_000));
    const rows = [note("fresh", { last_loaded_on: recent }), note("never"), note("old", { last_loaded_on: "2020-01-01" })];
    expect(filterNotes(rows, { ...base, dormant: true }).map((n) => n.id).sort()).toEqual(["never", "old"]);
  });
});

describe("filter URL", () => {
  test("round-trips every part, and ignores values it does not know", () => {
    const filter: NotesFilter = { scope: "personal", query: "rent", sort: "edited", view: "all", narrowness: "targeted", step: "classify", target: "netcup", dormant: true };
    expect(parseFilter(new URLSearchParams(searchOf(filter)))).toEqual(filter);
    expect(parseFilter(new URLSearchParams("narrow=sideways&step=nope&dormant=0"))).toMatchObject({ narrowness: "", step: "", dormant: false });
    expect(searchOf(parseFilter(new URLSearchParams("")))).toBe("");
  });
});

describe("queued note writes", () => {
  test("a create carries its targeting, and applying it fills the mirror row", async () => {
    await applyOptimistic(intent("note.create", {
      id: "n1", content: "Netcup is automated", scope: "personal", expiresAt: null,
      steps: ["classify"], appliesTo: { senders: ["netcup"] }, activeFrom: null,
    }, 1));
    expect(await db.get<NoteRow>("notes", "n1")).toMatchObject({ steps: ["classify"], applies_to: { senders: ["netcup"] }, active_from: null, load_count: 0 });
  });

  test("an update sends snake_case keys for exactly what changed, expiry included", async () => {
    await db.put("notes", note("n1"));
    const calls = stubFetch(() => ok());
    await queue(
      intent("note.update", { id: "n1", patch: { expiresAt: "2030-12-01", steps: ["classify"], appliesTo: null, activeFrom: "2030-02-01" }, baseUpdatedAt: null }, 1),
      intent("note.update", { id: "n1", patch: { content: "only text" }, baseUpdatedAt: null }, 2),
    );
    await drain((input, init) => fetch(input, init));
    expect(calls[0].body).toEqual({ expires_at: "2030-12-01", steps: ["classify"], applies_to: null, active_from: "2030-02-01", base_updated_at: null });
    expect(calls[1].body).toEqual({ content: "only text", base_updated_at: null });
  });
});

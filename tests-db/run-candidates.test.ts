// src/evaluation/run-candidates.ts against real SQL: one row per newsletter claim and news story with
// its verdicts and News editor position, personal items left out, idempotent, and kept after a rerun
// deletes the extraction rows.
import { beforeEach, describe, expect, test } from "bun:test";
import { useTestDatabase } from "./fixtures/database";

const database = await useTestDatabase();
const { db, pipelineRuns, runCandidates } = await import("../src/db");
const { recordRunCandidates } = await import("../src/evaluation/run-candidates");

const DAY = "2026-10-05";
let runId = "";

async function delivery(sourceType: string, sourceName: string) {
  const [row] = await database.sql`insert into raw_items (run_date, source_type, source_name, raw_content) values (${DAY}, ${sourceType}, ${sourceName}, 'x') returning id`;
  return row!.id as string;
}
async function extraction(rawItemId: string, json: object, over: { gate?: boolean | null; handoff?: string | null; order?: number | null; included?: boolean } = {}) {
  const [row] = await database.sql`
    insert into extractions (raw_item_id, run_date, extracted_json, relevance_score, gate_passed, gate_reason, synthesis_handoff, synthesis_order, included_in_report)
    values (${rawItemId}, ${DAY}, ${JSON.stringify(json)}::jsonb, 4, ${over.gate ?? true}, 'ok', ${over.handoff ?? null}, ${over.order ?? null}, ${over.included ?? false}) returning id`;
  return row!.id as string;
}
const story = (desk: string, significance: number) => ({ desk, significance, headline: `${desk} ${significance}` });
const rows = () => db.select().from(runCandidates);

beforeEach(async () => {
  await database.sql`truncate pipeline_runs, raw_items, extractions cascade`;
  [{ id: runId }] = await db.insert(pipelineRuns).values({ runDate: DAY }).returning({ id: pipelineRuns.id });
});

describe("run candidate ledger", () => {
  test("records verdicts, outcomes and the editor's input order, and skips personal items", async () => {
    const letter = await delivery("newsletter", "Example Letter");
    const sent = await extraction(letter, { headline: "a" }, { handoff: "sent", order: 1, included: true });
    const over = await extraction(letter, { headline: "b" }, { handoff: "outside_synthesis_capacity", order: 31 });
    const rejected = await extraction(letter, { headline: "c" }, { gate: false });
    const world = await delivery("web_news", "news:world");
    const home = await delivery("web_news", "news:home");
    const low = await extraction(world, story("world", 2), { included: true });
    const high = await extraction(world, story("world", 5));
    const local = await extraction(home, story("home", 3));
    const held = await extraction(home, story("home", 5), { gate: false });
    const mail = await delivery("personal_email", "Someone");
    await extraction(mail, { type: "personal" });

    expect(await recordRunCandidates(runId, DAY)).toBe(7);
    const byId = new Map((await rows()).map((r) => [r.extractionId, r]));
    expect(byId.size).toBe(7);
    expect(byId.get(sent)!.outcome).toBe("cited");
    expect(byId.get(over)!.outcome).toBe("outside_synthesis_capacity");
    expect(byId.get(rejected)!.outcome).toBe("gate_rejected");
    expect(byId.get(over)!.newsEditorOrder).toBeNull();
    // World desk first, most significant first, then the home desk; a held story has no position.
    expect([high, low, local].map((id) => byId.get(id)!.newsEditorOrder)).toEqual([1, 2, 3]);
    expect(byId.get(held)!.newsEditorOrder).toBeNull();
    expect(byId.get(low)!.outcome).toBe("cited");
    expect(byId.get(high)!.outcome).toBe("sent_omitted");
  });

  test("a repeat refreshes rows instead of adding them", async () => {
    const world = await delivery("web_news", "news:world");
    const id = await extraction(world, story("world", 4));
    await recordRunCandidates(runId, DAY);
    await database.sql`update extractions set included_in_report = true where id = ${id}`;
    await recordRunCandidates(runId, DAY);
    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0]!.includedInReport).toBe(true);
    expect(all[0]!.outcome).toBe("cited");
  });

  test("the rows outlive a rerun that deletes the extractions", async () => {
    const world = await delivery("web_news", "news:world");
    await extraction(world, story("world", 4));
    await recordRunCandidates(runId, DAY);
    await database.sql`delete from extractions`;
    expect(await rows()).toHaveLength(1);
  });

  test("nothing to record is zero and never throws", async () => {
    expect(await recordRunCandidates(runId, DAY)).toBe(0);
    expect(await recordRunCandidates("00000000-0000-0000-0000-000000000000", DAY)).toBe(0);
  });
});

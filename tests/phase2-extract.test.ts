// Protects Phase 2 reruns: extraction IDs and downstream verdicts survive a rerun, and a retry replaces
// a failed placeholder. The db is an in-memory mock (mock.module below); the model call is stubbed.
import { beforeEach, expect, mock, test } from "bun:test";
import * as schema from "../src/db/schema";

const item = {
  id: "00000000-0000-4000-8000-000000000001",
  runDate: "2026-09-30",
  sourceType: "newsletter",
  sourceName: "Test Letter",
  accountId: null,
  rawContent: "A test newsletter",
};

type SavedExtraction = {
  id: string;
  aiFailed: boolean;
  rawItemId: string;
  extractedJson: unknown;
  gatePassed?: boolean;
  includedInReport?: boolean;
};

let saved: SavedExtraction[] = [];
let calls = 0;
let failNext = false;
let nextId = 0;

// `loadClassificationContext` awaits `.from(contacts)`/`.from(notes)` directly, with no `.where()`
// chained - `then` makes that resolve too, alongside the `.where()` the rawItems/extractions
// queries chain.
const select = () => ({
  from: (table: unknown) => {
    const rows = table === schema.rawItems ? [item] : table === schema.extractions ? saved : [];
    return { where: async () => rows, then: (resolve: (rows: unknown[]) => void) => resolve(rows) };
  },
});

const db = {
  select,
  transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn({
    execute: async () => undefined,
    select,
    delete: () => ({ where: async () => { saved = []; } }),
    insert: () => ({
      values: async (values: Omit<SavedExtraction, "id">[]) => {
        saved.push(...values.map((value) => ({ ...value, id: `extraction-${++nextId}` })));
      },
    }),
  }),
};

mock.module("../src/db", () => ({ ...schema, db }));
mock.module("../src/config/email-accounts", () => ({ loadEmailAccounts: async () => [] }));
mock.module("../src/ai/active-prompts", () => ({
  resolveActivePrompts: async () => ({
    extraction: { text: "Extract newsletter" },
    entity_extraction: { text: "Extract entities" },
    personal_classification: { text: "Classify email" },
  }),
}));
mock.module("../src/ai/openai", () => ({
  extractJson: async (prompt: string) => {
    calls++;
    if (failNext) {
      failNext = false;
      throw new Error("model failed");
    }
    return prompt === "Extract entities"
      ? { entities: [], relations: [] }
      : {
          items: [
            { headline: "One", topic_tags: [], key_claim: "First", entities: [], relevance_score: 4 },
            { headline: "Two", topic_tags: [], key_claim: "Second", entities: [], relevance_score: 3 },
          ],
          skip_reason: null,
        };
  },
}));

const { runPhase2 } = await import("../src/pipeline/phase2-extract");

beforeEach(() => {
  saved = [];
  calls = 0;
  failNext = false;
  nextId = 0;
});

test("a rerun preserves extraction IDs and downstream verdicts without adding story rows", async () => {
  await runPhase2(item.runDate);
  const ids = saved.map((row) => row.id);
  saved[0].gatePassed = true;
  saved[0].includedInReport = true;
  await runPhase2(item.runDate);

  expect(saved.map((row) => row.id)).toEqual(ids);
  expect(saved).toHaveLength(2);
  expect(saved[0].gatePassed).toBe(true);
  expect(saved[0].includedInReport).toBe(true);
  expect(calls).toBe(2);
});

test("a retry replaces a failed placeholder with the complete newsletter result", async () => {
  failNext = true;
  await expect(runPhase2(item.runDate)).rejects.toThrow("1/1 items failed extraction");
  expect(saved).toHaveLength(1);
  expect(saved[0].aiFailed).toBe(true);

  await runPhase2(item.runDate);
  expect(saved).toHaveLength(2);
  expect(saved.every((row) => row.aiFailed === false)).toBe(true);
  expect(saved.map((row) => row.id)).toEqual(["extraction-2", "extraction-3"]);

  await runPhase2(item.runDate);
  expect(saved.map((row) => row.id)).toEqual(["extraction-2", "extraction-3"]);
  expect(calls).toBe(4);
});

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

let saved: { aiFailed: boolean; rawItemId: string; extractedJson: unknown }[] = [];
let calls = 0;
let failNext = false;

const select = () => ({
  from: (table: unknown) => ({
    where: async () => table === schema.rawItems ? [item] : table === schema.extractions ? saved : [],
  }),
});

const db = {
  select,
  transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn({
    execute: async () => undefined,
    select,
    delete: () => ({ where: async () => { saved = []; } }),
    insert: () => ({ values: async (values: typeof saved) => { saved.push(...values); } }),
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
});

test("a rerun keeps the two original story rows and does not call the model again", async () => {
  await runPhase2(item.runDate);
  const first = [...saved];
  await runPhase2(item.runDate);

  expect(saved).toEqual(first);
  expect(saved).toHaveLength(2);
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
});

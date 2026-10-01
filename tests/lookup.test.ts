import { describe, expect, mock, test } from "bun:test";
import * as schema from "../src/db/schema";

mock.module("../src/db", () => ({ ...schema, db: {} }));
mock.module("../src/pipeline/long-term-context", () => ({ loadLongTermContext: async () => ({}) }));
const { tokenize } = await import("../src/context/lookup");

describe("tokenize", () => {
  test("splits a phrase into lowercase words", () => {
    expect(tokenize("OCG  Akademie")).toEqual(["ocg", "akademie"]);
  });

  test("blank input has no tokens", () => {
    expect(tokenize("   ")).toEqual([]);
  });
});

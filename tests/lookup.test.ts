import { describe, expect, mock, test } from "bun:test";
import { dbModule } from "./fixtures/db";

mock.module("../src/db", () => dbModule({}));
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

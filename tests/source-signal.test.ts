import { describe, expect, test } from "bun:test";
import {
  countsAsIncluded,
  dailyComposite,
  neutralRelevance,
  trustComposite,
  trustFromComposite,
  type ScoredItem,
} from "../src/pipeline/source-signal";

const item = (over: Partial<ScoredItem> = {}): ScoredItem => ({
  relevanceScore: 3,
  gateReason: "below_threshold",
  gateDetail: { corroborationBonus: 0 },
  includedInReport: false,
  ...over,
});

describe("neutralRelevance", () => {
  test("is the score plus corroboration, with no trust factor", () => {
    expect(neutralRelevance(item({ relevanceScore: 4, gateDetail: { corroborationBonus: 0.3 } }))).toBeCloseTo(4.3);
  });

  test("tolerates rows without a recorded gate verdict or score", () => {
    expect(neutralRelevance(item({ gateDetail: null }))).toBe(3);
    expect(neutralRelevance(item({ relevanceScore: null, gateDetail: null }))).toBe(0);
  });
});

describe("countsAsIncluded", () => {
  test("an item in the report counts", () => {
    expect(countsAsIncluded(item({ includedInReport: true, gateReason: "passed" }))).toBe(true);
  });

  test("an item only trust kept out counts, so a distrusted source can show it deserves more", () => {
    expect(countsAsIncluded(item({ relevanceScore: 3 }))).toBe(true);
    expect(countsAsIncluded(item({ relevanceScore: 2.7, gateDetail: { corroborationBonus: 0.3 } }))).toBe(true);
  });

  test("an item that would not have cleared at neutral trust does not", () => {
    expect(countsAsIncluded(item({ relevanceScore: 2 }))).toBe(false);
  });

  test("teasers, skipped mail and items synthesis left out do not", () => {
    expect(countsAsIncluded(item({ gateReason: "teaser_only", relevanceScore: 3 }))).toBe(false);
    expect(countsAsIncluded(item({ gateReason: "skipped_by_extraction", relevanceScore: 0 }))).toBe(false);
    expect(countsAsIncluded(item({ gateReason: "passed", relevanceScore: 4 }))).toBe(false);
  });
});

describe("trust from composites", () => {
  test("a daily composite is 7 points of quality plus 3 of breadth, capped at 10", () => {
    expect(dailyComposite(5, 1)).toBe(10);
    expect(dailyComposite(3, 0.5)).toBeCloseTo(5.7);
    expect(dailyComposite(6, 1)).toBe(10);
  });

  test("5/10 is neutral and the range is clamped to 0.5-2.0", () => {
    expect(trustFromComposite(5)).toBe(1);
    expect(trustFromComposite(0)).toBe(0.5);
    expect(trustFromComposite(12)).toBe(2);
  });

  test("a better recent week lifts trust once it rests on enough items", () => {
    expect(trustComposite(3, 6.5, 14)).toBe(6.5);
    expect(trustComposite(3, 6.5, 4)).toBe(3);
    expect(trustComposite(3, null, 0)).toBe(3);
  });

  test("a worse recent week does not drop trust early", () => {
    expect(trustComposite(6, 2, 20)).toBe(6);
  });
});

import { describe, expect, test } from "bun:test";
import type { activeTopics } from "../src/db/schema";
import {
  agedTopicStatus,
  isMoreValuable,
  normalizeTopicImportance,
  rankTopicImportance,
  revivableTopics,
  TOPIC_ACTIVE_CAP,
  TOPIC_ARCHIVE_DAYS,
  TOPIC_DORMANT_DAYS,
  weakestActiveTopic,
} from "../src/pipeline/topic-lifecycle";

type Topic = typeof activeTopics.$inferSelect;
const topic = (id: string, headline: string, status: string, lastUpdated = "2026-09-01") =>
  ({ id, headline, status, lastUpdated } as Topic);

describe("topic lifecycle", () => {
  test("moves quiet active topics to dormant after seven days", () => {
    expect(TOPIC_DORMANT_DAYS).toBe(7);
    expect(agedTopicStatus("active", "2026-09-24", "2026-09-30")).toBeNull();
    expect(agedTopicStatus("active", "2026-09-23", "2026-09-30")).toBe("dormant");
  });

  test("archives dormant topics after thirty days, retaining the prior state transition", () => {
    expect(TOPIC_ARCHIVE_DAYS).toBe(30);
    expect(agedTopicStatus("dormant", "2026-09-01", "2026-09-30")).toBeNull();
    expect(agedTopicStatus("dormant", "2026-08-31", "2026-09-30")).toBe("archived");
    expect(agedTopicStatus("active", "2026-08-01", "2026-09-30")).toBe("dormant");
    expect(agedTopicStatus("resolved", "2026-08-01", "2026-09-30")).toBeNull();
  });

  test("shortlists dormant and archived matches without treating a shared domain as a match", () => {
    const candidates = [
      topic("a", "OpenAI Orion model rollout", "dormant"),
      topic("b", "Swiss grid electricity reform", "archived"),
      topic("c", "AI safety summit", "dormant"),
      topic("d", "OpenAI Orion model rollout", "resolved"),
    ];
    const result = revivableTopics(candidates, [{
      headline: "OpenAI expands Orion rollout to Europe",
      key_claim: "More companies can use the Orion model this week.",
      entities: ["OpenAI", "Orion"],
    }]);
    expect(result.map((row) => row.id)).toEqual(["a"]);
  });

  test("normalizes model-supplied importance, defaulting anything unrecognized to normal", () => {
    expect(normalizeTopicImportance("high")).toBe("high");
    expect(normalizeTopicImportance("low")).toBe("low");
    expect(normalizeTopicImportance("normal")).toBe("normal");
    expect(normalizeTopicImportance(undefined)).toBe("normal");
    expect(normalizeTopicImportance("urgent")).toBe("normal");
  });

  test("ranks importance high > normal > low", () => {
    expect(rankTopicImportance("high")).toBeGreaterThan(rankTopicImportance("normal"));
    expect(rankTopicImportance("normal")).toBeGreaterThan(rankTopicImportance("low"));
    expect(rankTopicImportance(null)).toBe(rankTopicImportance("normal"));
  });

  test("finds the weakest active topic by importance, then by less momentum", () => {
    const ranked = (importance: string | null, updateCount: number, lastUpdated: string) =>
      ({ importance, updateCount, lastUpdated });
    expect(weakestActiveTopic([])).toBeNull();
    expect(weakestActiveTopic([
      ranked("high", 5, "2026-09-20"),
      ranked("low", 2, "2026-09-15"),
      ranked("normal", 10, "2026-09-29"),
    ])).toEqual(ranked("low", 2, "2026-09-15"));
    // Tied importance: fewer carried-forward updates loses.
    expect(weakestActiveTopic([
      ranked("normal", 8, "2026-09-01"),
      ranked("normal", 1, "2026-09-20"),
    ])).toEqual(ranked("normal", 1, "2026-09-20"));
    // Tied importance and update count: older lastUpdated loses.
    expect(weakestActiveTopic([
      ranked("normal", 3, "2026-09-10"),
      ranked("normal", 3, "2026-09-05"),
    ])).toEqual(ranked("normal", 3, "2026-09-05"));
  });

  test("admits a candidate only on a strict improvement over the incumbent, never a tie", () => {
    const incumbent = { importance: "normal", updateCount: 4, lastUpdated: "2026-09-01" };
    expect(isMoreValuable("high", incumbent)).toBe(true);
    expect(isMoreValuable("normal", incumbent)).toBe(false);
    expect(isMoreValuable("low", incumbent)).toBe(false);
  });

  test("caps concurrently active topics at a fixed, sane ceiling", () => {
    expect(TOPIC_ACTIVE_CAP).toBeGreaterThan(0);
    expect(Number.isInteger(TOPIC_ACTIVE_CAP)).toBe(true);
  });
});

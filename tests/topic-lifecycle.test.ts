import { describe, expect, test } from "bun:test";
import type { activeTopics } from "../src/db/schema";
import { agedTopicStatus, revivableTopics, TOPIC_ARCHIVE_DAYS, TOPIC_DORMANT_DAYS } from "../src/pipeline/topic-lifecycle";

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
});

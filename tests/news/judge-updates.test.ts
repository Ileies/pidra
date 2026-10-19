// The repeat judge's hold on "UPDATE:": a desk's update stays one only when the judge ties it to a told story.
import { describe, expect, test } from "bun:test";
import { demoteUnlinkedUpdates, type Candidate } from "../../src/news/validate";

const candidate = (status: "new" | "update", stored = false): Candidate =>
  ({ desk: "world", deskOrder: 0, story: { headline: "x", status }, validation: {}, stored }) as unknown as Candidate;

describe("demoteUnlinkedUpdates", () => {
  test("an update tied to a told story stays an update, one tied to nothing runs as new", () => {
    const linked = candidate("update");
    const orphan = candidate("update");
    demoteUnlinkedUpdates([linked, orphan], new Set([linked]));
    expect(linked.story.status).toBe("update");
    expect(orphan.story.status).toBe("new");
  });

  test("a stored story is never rewritten", () => {
    const stored = candidate("update", true);
    demoteUnlinkedUpdates([stored], new Set());
    expect(stored.story.status).toBe("update");
  });
});

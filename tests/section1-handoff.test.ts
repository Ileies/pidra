import { expect, test } from "bun:test";
import { handoffForOrder, orderNewsletterItems, SECTION1_CAPACITY } from "../src/pipeline/section1-handoff";

test("Section 1 orders all eligible claims by score and stable ID before applying capacity", () => {
  const items = Array.from({ length: SECTION1_CAPACITY + 2 }, (_, index) => ({
    extraction: {
      id: `claim-${String(SECTION1_CAPACITY + 2 - index).padStart(2, "0")}`,
      effectiveRelevance: index === 0 ? 5 : 3,
    },
  }));

  const ordered = orderNewsletterItems(items);
  expect(ordered).not.toBe(items);
  expect(ordered[0]).toBe(items[0]);
  expect(ordered[1].extraction.id).toBe("claim-01");
  expect(ordered[SECTION1_CAPACITY - 1].extraction.id).toBe("claim-29");
  expect(ordered[SECTION1_CAPACITY].extraction.id).toBe("claim-30");
  expect(handoffForOrder(SECTION1_CAPACITY)).toBeNull();
  expect(handoffForOrder(SECTION1_CAPACITY + 1)).toBe("outside_synthesis_capacity");
  expect(handoffForOrder(null)).toBeNull();
});

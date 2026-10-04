import { expect, test } from "bun:test";
import { sourceItemDetailHref } from "../src/lib/sourceLinks.ts";

const ID = "00000000-0000-4000-8000-000000000001";

test("source delivery links use an ISO date from text or a database Date", () => {
  const expected = `/2026-09-29/detail/${ID}`;
  expect(sourceItemDetailHref("2026-09-29", ID)).toBe(expected);
  expect(sourceItemDetailHref(new Date("2026-09-29T00:00:00.000Z"), ID)).toBe(expected);
  expect(() => sourceItemDetailHref("Tue Sep 29 2026", ID)).toThrow("Invalid source delivery date");
});

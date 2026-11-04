/** Regression coverage for uneven note heights, composers and responsive masonry placement. */
import { expect, test } from "bun:test";
import { masonryLayout } from "../src/lib/ui/masonry.js";

test("short cards fill the space beside a tall note instead of piling into its column", () => {
  const heights = [100, 600, 100, 100, 100, 100, 100, 100, 100];
  const layout = masonryLayout(heights, 3);
  const bottoms = [0, 0, 0];
  layout.positions.forEach(({ column, top }, i) => {
    expect(top).toBe(bottoms[column] ? bottoms[column] + 12 : 0);
    bottoms[column] = top + heights[i];
  });
  expect(bottoms).toEqual([436, 600, 436]);
  expect(layout.height).toBe(600);
});

test("the composer contributes its height and gap to the first column", () => {
  expect(masonryLayout([100, 100, 100], 3, 300)).toEqual({
    positions: [{ column: 1, top: 0 }, { column: 2, top: 0 }, { column: 1, top: 112 }],
    height: 300,
  });
});

test("one column keeps source order and includes the composer", () => {
  expect(masonryLayout([100, 200], 1, 50)).toEqual({
    positions: [{ column: 0, top: 62 }, { column: 0, top: 174 }], height: 374,
  });
});

test("empty layouts reserve only the visible composer's height", () => {
  expect(masonryLayout([], 3).height).toBe(0);
  expect(masonryLayout([], 2, 150).height).toBe(150);
});

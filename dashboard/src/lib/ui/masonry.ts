/** Measured masonry placement, shared by the responsive card layout and its regression tests. */

/** Preserve source order while filling the shortest column; the optional composer occupies column 0. */
export function masonryLayout(heights: readonly number[], count: number, leadHeight = 0, gap = 12) {
  const bottoms = Array<number>(count).fill(0);
  if (leadHeight > 0) bottoms[0] = leadHeight + gap;
  const positions = heights.map((height) => {
    const column = bottoms.indexOf(Math.min(...bottoms));
    const top = bottoms[column];
    bottoms[column] += height + gap;
    return { column, top };
  });
  return { positions, height: Math.max(0, ...bottoms.map((bottom) => bottom - gap)) };
}

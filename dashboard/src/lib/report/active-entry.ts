/**
 * Which report entry a chapter is speaking at a given moment. The speech endpoint returns no
 * timings, so this places the position among the chapter's segments by their share of the
 * characters: an estimate that can be off by a second or two, which an entry-sized highlight absorbs.
 */

export interface Segment {
  /** An entry id as the report page builds it (`p:group:entry`, see `src/audio/chapters.ts`), null for a spoken heading. */
  id: string | null;
  chars: number;
}

/** The line break between two entries is a pause, worth a few characters of speech. */
const PAUSE_CHARS = 6;

export function activeEntryId(segments: Segment[], positionSeconds: number, durationSeconds: number): string | null {
  if (segments.length === 0) return null;
  const weights = segments.map((s) => s.chars + PAUSE_CHARS);
  const total = weights.reduce((sum, w) => sum + w, 0);
  const target = Math.min(1, positionSeconds / Math.max(durationSeconds, 0.001)) * total;
  let seen = 0;
  for (let i = 0; i < weights.length; i++) {
    seen += weights[i];
    if (target < seen) return segments[i].id;
  }
  return segments[segments.length - 1].id;
}

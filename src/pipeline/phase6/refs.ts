import { db, extractions } from "../../db";
import { eq } from "drizzle-orm";

// Synthesis anchors each claim back to the extractions it came from with `<!--refs:id,id-->`,
// which the dashboard turns into a "Mehr dazu" deep link. Nothing used to check that the ids
// were real: on the first full run, 3 of 26 pointed at nothing (one mis-transcribed UUID, two
// invented outright), so those links were dead on arrival.
const REF_BLOCK_RE = /<!--refs:([^>]*)-->/g;

/** Levenshtein distance test that bails out as soon as it is certain the limit is exceeded. */
function withinEditDistance(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur: number[] = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return false;
    prev = cur;
  }
  return prev[b.length] <= max;
}

/**
 * Rewrites every `<!--refs:-->` block so it only contains ids that resolve to a real extraction
 * from this run, and returns the surviving ids. A one-character transcription slip is repaired
 * when exactly one real id is within a single edit; anything else is dropped, because a link to
 * nothing is worse than no link.
 */
export async function resolveReportRefs(
  report: string,
  runDate: string,
): Promise<{ report: string; includedIds: string[] }> {
  const candidates = new Set<string>();
  for (const match of report.matchAll(REF_BLOCK_RE)) {
    for (const raw of match[1].split(",")) {
      const id = raw.trim();
      if (id) candidates.add(id);
    }
  }
  if (candidates.size === 0) {
    console.warn("[Phase 6] Report carries no <!--refs:--> anchors - no deep links, no include data");
    return { report, includedIds: [] };
  }

  const rows = await db
    .select({ id: extractions.id })
    .from(extractions)
    .where(eq(extractions.runDate, runDate));
  const real = new Map(rows.map((r) => [r.id.toLowerCase(), r.id]));
  const realHex = [...real.keys()].map((id) => ({ id, hex: id.replace(/-/g, "") }));

  const resolved = new Map<string, string | null>();
  let repaired = 0;
  for (const candidate of candidates) {
    const exact = real.get(candidate.toLowerCase());
    if (exact) {
      resolved.set(candidate, exact);
      continue;
    }
    const hex = candidate.toLowerCase().replace(/[^0-9a-f]/g, "");
    const near = realHex.filter((r) => withinEditDistance(hex, r.hex, 1));
    if (near.length === 1) {
      resolved.set(candidate, real.get(near[0].id)!);
      repaired++;
    } else {
      resolved.set(candidate, null);
    }
  }

  const dropped = [...resolved].filter(([, target]) => target === null).map(([id]) => id);
  const cleaned = report.replace(REF_BLOCK_RE, (_block, inner: string) => {
    const kept = [
      ...new Set(
        inner
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .map((id) => resolved.get(id))
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    return kept.length > 0 ? `<!--refs:${kept.join(",")}-->` : "";
  });

  const includedIds = [...new Set([...resolved.values()].filter((id): id is string => Boolean(id)))];
  console.log(
    `[Phase 6] Report refs: ${candidates.size} cited, ${includedIds.length} resolved` +
      (repaired > 0 ? `, ${repaired} repaired` : "") +
      (dropped.length > 0 ? `, ${dropped.length} dropped` : ""),
  );
  if (dropped.length > 0) {
    console.warn(`[Phase 6] Unresolvable refs removed from the report: ${dropped.join(", ")}`);
  }

  return { report: cleaned, includedIds };
}

import { heldBack } from "./checks";
import type { Candidate, DeskStory, NewsValidation, ReportedStory } from "./types";
import { articleKey } from "./url";

const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "after", "over", "into", "amid", "says", "said", "its",
  "are", "was", "were", "has", "have", "had", "will", "new", "than", "that", "this", "their",
  "his", "her", "who", "what", "why", "how", "about", "against", "under", "more", "less",
]);

/**
 * The content words of a headline. Numbers stay whatever their length: "6-0" and "3%" are what
 * tell two otherwise identical match reports apart.
 */
function headlineTokens(headline: string): Set<string> {
  return new Set(
    headline
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .split(/[^\p{L}\p{N}%]+/u)
      .filter((token) => (token.length > 2 || /\d/.test(token)) && !STOPWORDS.has(token)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared++;
  return shared / (a.size + b.size - shared);
}

/**
 * Conservative on purpose: same article, or nearly the same headline. The editor merges the fuzzier
 * duplicates it can see ("If two stories describe the same event, write one bullet"); this only
 * has to catch the ones that are certain, so that no story is held back by a false match.
 */
const SAME_HEADLINE = 0.6;
const MIN_TOKENS = 3;

export function sameStory(
  a: { headline: string; urls: string[] },
  b: { headline: string; urls: string[] },
): boolean {
  const keysA = new Set(a.urls.map(articleKey).filter((key): key is string => key !== null));
  if (b.urls.some((url) => { const key = articleKey(url); return key !== null && keysA.has(key); })) return true;

  const tokensA = headlineTokens(a.headline);
  const tokensB = headlineTokens(b.headline);
  if (tokensA.size < MIN_TOKENS || tokensB.size < MIN_TOKENS) return false;

  // Two headlines that both carry figures and disagree on them are two stories, however alike
  // the words: 6-0 and 2-1 are different matches, and a death toll that rose from 50 to 120 is
  // precisely the update the reader should not have held back as already reported.
  const figures = (tokens: Set<string>) => [...tokens].filter((t) => /\d/.test(t)).sort().join(" ");
  const figuresA = figures(tokensA);
  const figuresB = figures(tokensB);
  if (figuresA && figuresB && figuresA !== figuresB) return false;

  return jaccard(tokensA, tokensB) >= SAME_HEADLINE;
}

/**
 * The order in which copies of one story are kept: stored stories first, whatever their rank (their
 * verdict is on record and may already be in a report, so a fresh copy matching one is the
 * duplicate), then the more significant copy, then the desk earlier in the section.
 */
export function keepOrder(candidates: Candidate[]): Candidate[] {
  const rank = (c: Candidate) => c.story.significance * 10 - c.deskOrder;
  return [
    ...candidates.filter((c) => c.stored),
    ...candidates.filter((c) => !c.stored).sort((a, b) => rank(b) - rank(a)),
  ];
}

/**
 * Marks cross-desk duplicates within one run. The more significant copy is kept, and on a tie the
 * desk that comes first in the section. A candidate already stored by an earlier run of the day is
 * never re-judged, only compared against, because its verdict is on record.
 *
 * `passes` says whether a copy would clear the gate on its own. A copy that would not can neither
 * be kept nor make another one a duplicate: an already-reported copy must not swallow the update a
 * second desk marked as new, and a story under its bar must not swallow one that clears it. The
 * pipeline passes the gate itself, so the two can never disagree.
 */
export function markDuplicates(
  candidates: Candidate[],
  passes: (candidate: Candidate) => boolean = (candidate) => !heldBack(candidate.validation),
): void {
  const ordered = keepOrder(candidates);
  const kept: Candidate[] = [];

  for (const candidate of ordered) {
    if (!passes(candidate)) continue;
    const urls = candidate.story.sources.map((s) => s.url);
    const match = kept.find((k) => sameStory(
      { headline: k.story.headline, urls: k.story.sources.map((s) => s.url) },
      { headline: candidate.story.headline, urls },
    ));
    if (match && !candidate.stored) {
      candidate.validation.duplicateOf = { desk: match.desk, headline: match.story.headline };
    } else {
      kept.push(candidate);
    }
  }
}

/**
 * A story the reader already saw is held back unless the desk marked it as an update, which is its
 * claim that something new happened inside the window.
 */
export function findAlreadyReported(story: DeskStory, reported: ReportedStory[]): NewsValidation["alreadyReported"] {
  if (story.status === "update") return null;
  const urls = story.sources.map((s) => s.url);
  const hit = reported.find((r) => sameStory({ headline: r.headline, urls: r.urls }, { headline: story.headline, urls }));
  return hit ? { date: hit.date, headline: hit.headline } : null;
}

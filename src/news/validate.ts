/**
 * The deterministic checks between a news desk's answer and the report.
 *
 * A desk is a model with a search engine, and the two ways it can mislead are well known: it can
 * cite something it never read, and it can present an old story as today's. Neither needs a
 * second model call to catch. The search tool reports every URL it returned, so a story whose
 * sources are all absent from that list was not taken from the search. And every story carries
 * the date of its development, so a stale one can be told apart from a fresh one.
 *
 * Nothing here drops a story. It records a verdict on the story (`NewsValidation`), and the Phase 3
 * gate turns that into a named reason, so a story the reader never saw is still visible on
 * `/[date]/triage` with the reason it was held back.
 *
 * Pure, so the rules are testable without a database or an API key.
 */

import type { DeskId, HomeConfig, NewsWindow } from "./desks";

/** A story as the desk's JSON schema returns it. */
export interface DeskStory {
  headline: string;
  summary: string;
  context: string;
  significance: 1 | 2 | 3 | 4 | 5;
  status: "new" | "update";
  confidence: "confirmed" | "reported" | "unconfirmed";
  region: string;
  topic: string;
  happened_at: string;
  entities: string[];
  sources: { publisher: string; title: string; url: string }[];
}

/** The verdict, stored on the extraction as `extracted_json.validation` and read by the gate. */
export interface NewsValidation {
  /** At least one source is a URL the search returned. Null when the call reported no sources. */
  verified: boolean | null;
  /** Cited URLs that the search never returned, for the record. */
  unverifiedUrls: string[];
  /** Whether the development falls inside the window. Null when the date could not be read. */
  inWindow: boolean | null;
  /** Set when another desk's story in the same run is the same event and was kept instead. */
  duplicateOf: { desk: DeskId; headline: string } | null;
  /** Set when the reader was already told this story on an earlier day and nothing new happened. */
  alreadyReported: { date: string; headline: string } | null;
  /**
   * A home-desk story about one of the countries the reader follows from abroad. Not a failed
   * check but a higher bar: the desk is told those countries get their top headlines only, and on
   * the first real run it still returned three minor German stories that crowded out the city.
   * Absent on rows stored before the flag existed, which reads as false.
   */
  abroad?: boolean;
}

/**
 * A story as stored on its extraction row. `key_claim` holds the summary, the field newsletter
 * items use, so the cards, triage and "More on this" read a news story without a special case.
 */
export interface NewsExtraction {
  desk: DeskId;
  headline: string;
  key_claim: string;
  context: string;
  significance: DeskStory["significance"];
  status: DeskStory["status"];
  confidence: DeskStory["confidence"];
  region: string;
  topic: string;
  happened_at: string;
  entities: string[];
  sources: DeskStory["sources"];
  validation: NewsValidation;
}

/** A story from a previous briefing that the reader actually saw. */
export interface ReportedStory {
  date: string;
  headline: string;
  urls: string[];
}

/** How far before the window a development may lie and still count, for time zones and a late run. */
const WINDOW_TOLERANCE_MS = 12 * 3600_000;

/**
 * The URL with the noise removed. The model appends `utm_source=openai` to the links it writes,
 * and a trailing slash or `www.` is not a different article.
 */
export function cleanUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith("utm_")) url.searchParams.delete(key);
    }
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

/** Host and path, which is what identifies an article. Query strings vary between two links to it. */
export function articleKey(raw: string): string | null {
  const cleaned = cleanUrl(raw);
  if (!cleaned) return null;
  const url = new URL(cleaned);
  return `${url.host.replace(/^www\./, "").toLowerCase()}${url.pathname.replace(/\/+$/, "")}`;
}

/**
 * Whether a URL points at an article rather than a home or section page. The desks sometimes cite a
 * front page as a source (`swissinfo.ch/ger/` and `arabnews.com/middle-east` on the second probe),
 * which proves nothing and helps no reader. An article's path is specific: three or more segments,
 * a digit somewhere (an id, a date), or a slug of real length.
 */
export function looksLikeArticle(raw: string): boolean {
  try {
    const url = new URL(raw);
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length === 0) return url.search.length > 1;
    if (segments.length >= 3 || /\d/.test(url.pathname + url.search)) return true;
    const last = segments[segments.length - 1];
    return last.length >= 16 || last.split(/[-_]/).length >= 3;
  } catch {
    return false;
  }
}

/**
 * Text as a report may show it. The model embeds citations in prose despite being told not to
 * (the first probe returned `([devdiscourse.com](https://...?utm_source=openai))` inside a
 * summary), and links in report prose are only ever attached deterministically, from checked
 * sources.
 */
export function cleanText(text: string): string {
  return text
    .replace(/\(\s*\[([^\]]*)\]\([^)]*\)\s*\)/g, "")
    .replace(/\[([^\]]*)\]\((?:https?:)?[^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+([.,;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Whether the development falls inside the window. Only staleness is judged: an old story
 * presented as today's is the failure, while a date after the window is an announced event and
 * is left alone. A bare date is read as the whole of that day, in UTC.
 */
export function withinWindow(happenedAt: string, window: NewsWindow): boolean | null {
  const value = happenedAt.trim();
  if (!value) return null;

  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const parsed = Date.parse(dateOnly ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(parsed)) return null;

  const latestMoment = dateOnly ? parsed + 24 * 3600_000 : parsed;
  return latestMoment >= Date.parse(window.start) - WINDOW_TOLERANCE_MS;
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "after", "over", "into", "amid", "says", "said", "its",
  "are", "was", "were", "has", "have", "had", "will", "new", "than", "that", "this", "their",
  "his", "her", "who", "what", "why", "how", "about", "against", "under", "more", "less",
]);

/**
 * The content words of a headline. Numbers stay whatever their length: "6-0" and "3%" are what
 * tell two otherwise identical match reports apart.
 */
export function headlineTokens(headline: string): Set<string> {
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
 * Whether any cited source is one the search returned. `consulted` is null when the call searched
 * but reported no URLs, which cannot be judged either way; an empty list means nothing was
 * searched at all, and a story from a desk that never searched is its memory, not today's news.
 */
export function verifySources(
  story: Pick<DeskStory, "sources">,
  consulted: string[] | null,
): Pick<NewsValidation, "verified" | "unverifiedUrls"> {
  const urls = story.sources.map((source) => source.url);
  if (urls.length === 0) return { verified: false, unverifiedUrls: [] };
  if (consulted === null) return { verified: null, unverifiedUrls: [] };

  const known = new Set(consulted.map(articleKey).filter((key): key is string => key !== null));
  const unverifiedUrls = story.sources
    .map((source) => source.url)
    .filter((url) => { const key = articleKey(url); return key === null || !known.has(key); });

  return { verified: unverifiedUrls.length < story.sources.length, unverifiedUrls };
}

/**
 * Whether a home-desk story belongs to one of the also-countries rather than to home. Read off the
 * `region` the desk is told to fill with exactly one of those names; home wins a tie, so a story
 * about both countries is judged as home news.
 */
export function isAbroad(region: string, home: Pick<HomeConfig, "city" | "countryName" | "also"> | null): boolean {
  if (!home || home.also.length === 0) return false;
  const value = region.toLowerCase();
  if (value.includes(home.countryName.toLowerCase())) return false;
  if (home.city && value.includes(home.city.toLowerCase())) return false;
  return home.also.some((country) => value.includes(country.name.toLowerCase()));
}

/** Whether any check failed. The gate names which one; this only answers yes or no, for logs. */
export function heldBack(validation: NewsValidation): boolean {
  return validation.verified === false || validation.inWindow === false
    || validation.duplicateOf !== null || validation.alreadyReported !== null;
}

export interface Candidate {
  desk: DeskId;
  /** The desk's position in `DESKS`, the tie-break when two desks found the same story. */
  deskOrder: number;
  story: DeskStory;
  validation: NewsValidation;
  /** Already stored by an earlier run of the same day. Compared against, never re-judged. */
  stored: boolean;
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
  const rank = (c: Candidate) => c.story.significance * 10 - c.deskOrder;
  // Stored stories first, whatever their rank: their verdict is on record and may already be in a
  // report, so when a fresh copy matches one, the fresh copy is the duplicate.
  const ordered = [
    ...candidates.filter((c) => c.stored),
    ...candidates.filter((c) => !c.stored).sort((a, b) => rank(b) - rank(a)),
  ];
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

/**
 * Tidies a desk's story for storage: citations out of the prose, tracking parameters out of the
 * URLs, and sources dropped that have no usable URL or point at a front page rather than an article.
 */
export function tidyStory(story: DeskStory): DeskStory {
  return {
    ...story,
    headline: cleanText(story.headline),
    summary: cleanText(story.summary),
    context: cleanText(story.context),
    entities: [...new Set(story.entities.map((e) => e.trim()).filter(Boolean))].slice(0, 6),
    sources: story.sources
      .map((source) => ({ ...source, publisher: source.publisher.trim(), title: cleanText(source.title), url: cleanUrl(source.url) }))
      .filter((source): source is DeskStory["sources"][number] => source.url !== null && looksLikeArticle(source.url))
      .slice(0, 3),
  };
}

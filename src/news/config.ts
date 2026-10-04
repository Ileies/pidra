/**
 * The news desks: what each one covers, and the configuration that turns them on.
 *
 * Why desks exist at all. The newsletters are slow news by design (essays, research, analysis),
 * and none of the 32 is a general news source: nothing covers the world's front page, the
 * reader's own city, or what people around them are talking about. On a weekend they deliver
 * almost nothing. So the briefing could run for weeks without mentioning a war, an election or a
 * fire down the street, while the reader relies on it as their only news. Separate desks with
 * fixed Brave query budgets cover these mandates systematically.
 *
 * Pure on purpose, so the configuration is testable without a database or an API key.
 */

import type { PromptSection } from "../ai/active-prompts";

export type DeskId = "world" | "home" | "beat" | "field" | "talk" | "serendipity";

export interface Desk {
  id: DeskId;
  /** For logs, `raw_items.raw_content` and the triage view. */
  label: string;
  /** Each desk's mandate is its own prompt section, overridable by an active prompt version like any other. */
  section: Extract<PromptSection, `news_${string}`>;
  /**
   * How far Brave search is localised to the reader's home. The world, field and serendipity desks
   * must see the world rather than one country's view of it; home is about the city, talk about
   * the country.
   */
  locality: "city" | "country" | null;
  /**
   * Reasoning effort for the final structured answer. Search count is fixed separately in
   * `research.ts`; `NEWS_REASONING_EFFORT` overrides this without changing the Brave budget.
   */
  effort: "medium" | "high";
}

/**
 * In editor order: the order the News section presents them in. The beat desk exists because the
 * fields desk, given all of the reader's priorities at once, spread four search calls across seven
 * of them on its first real run, and the reader's first priority got two lumped queries. That one
 * priority is the reason the desks were asked for, so it gets a mandate of its own.
 */
export const DESKS: readonly Desk[] = [
  { id: "world", label: "World news desk", section: "news_world", locality: null, effort: "high" },
  { id: "home", label: "Home news desk", section: "news_home", locality: "city", effort: "high" },
  { id: "beat", label: "Beat news desk", section: "news_beat", locality: null, effort: "high" },
  { id: "field", label: "Fields news desk", section: "news_field", locality: null, effort: "high" },
  { id: "talk", label: "Talk of the day desk", section: "news_talk", locality: "country", effort: "high" },
  { id: "serendipity", label: "Something different desk", section: "news_serendipity", locality: null, effort: "high" },
];

/**
 * How many stories each part of the News section may show. The editor prompt states these numbers
 * and `enforceNewsCaps` (`format.ts`) applies them in code, so a model that overshoots is trimmed
 * rather than trusted. Lowered on 2026-10-01 after a 38-story report ("not going to read an entire
 * newspaper"); `fields` is the total across all field headings, `perField` the limit for one.
 */
export const NEWS_CAPS = { top: 6, home: 4, alsoCountry: 2, perField: 4, fields: 8, talk: 3, serendipity: 1 } as const;

/** 27 desk requests plus up to three Section 1 search slots make a full run's 30. */
export const SEARCH_BUDGET: Record<DeskId, readonly [number, number]> = {
  world: [4, 2], home: [3, 2], beat: [3, 3], field: [2, 2], talk: [2, 1], serendipity: [1, 2],
};

/** `raw_items.source_type` for a desk's delivery. */
export const NEWS_SOURCE_TYPE = "web_news";

/** `raw_items.source_name`, and the name a desk's failure is recorded under in `step_errors`. */
export const deskSource = (id: DeskId): string => `news:${id}`;

/** One delivery per desk per run date, which is what makes a re-run reuse instead of re-pay. */
export const deskMessageId = (runDate: string, id: DeskId): string => `news:${runDate}:${id}`;

export interface HomeConfig {
  city: string | null;
  region: string | null;
  /** ISO 3166-1 alpha-2, as Brave's `country` parameter wants it. */
  country: string;
  countryName: string;
  /** Countries whose national headlines matter from abroad: citizenship, family. */
  also: { code: string; name: string }[];
  /** The News section's heading for the home desk, e.g. "Springfield & Freedonia". */
  label: string;
}

const COUNTRY_CODE = /^[A-Z]{2}$/;

/** The English name of a region code, or null for a code that names no country ("XX"). */
function countryName(code: string): string | null {
  if (!COUNTRY_CODE.test(code)) return null;
  try {
    return new Intl.DisplayNames(["en"], { type: "region", fallback: "none" }).of(code) ?? null;
  } catch {
    return null;
  }
}

/**
 * The reader's home, from the environment. Configuration rather than profile text for two
 * reasons: Brave wants structured fields, and the profile carries far more than a
 * location, none of which a web-search call needs. Returns null when no country is set, which
 * switches the home desk off (and says so on the report, see `enabledDesks`).
 */
export function homeConfig(env: Record<string, string | undefined> = process.env): HomeConfig | null {
  const country = env.NEWS_HOME_COUNTRY?.trim().toUpperCase() ?? "";
  const name = countryName(country);
  if (!name) return null;

  const city = env.NEWS_HOME_CITY?.trim() || null;
  const region = env.NEWS_HOME_REGION?.trim() || null;
  const also = [...new Set((env.NEWS_ALSO_COUNTRIES ?? "").split(",").map((code) => code.trim().toUpperCase()))]
    .filter((code) => code !== country)
    .flatMap((code) => {
      const alsoName = countryName(code);
      return alsoName ? [{ code, name: alsoName }] : [];
    });

  return { city, region, country, countryName: name, also, label: city ? `${city} & ${name}` : name };
}

export interface DeskPlan {
  desks: Desk[];
  /** Desks that are enabled but cannot run. Surfaced as failures, because their news is missing. */
  unconfigured: { desk: Desk; reason: string }[];
}

/**
 * Which desks run. `NEWS_DESKS` is a comma-separated subset of the desk ids, `off` for none; unset
 * means all of them.
 */
export function enabledDesks(env: Record<string, string | undefined> = process.env): DeskPlan {
  const spec = env.NEWS_DESKS?.trim().toLowerCase();
  if (spec === "off" || spec === "none") return { desks: [], unconfigured: [] };

  const wanted = spec ? new Set(spec.split(",").map((s) => s.trim()).filter(Boolean)) : null;
  const selected = DESKS.filter((desk) => !wanted || wanted.has(desk.id));

  const home = homeConfig(env);
  const unconfigured = !home && selected.some((desk) => desk.id === "home")
    ? [{ desk: DESKS.find((desk) => desk.id === "home")!, reason: "not configured: set NEWS_HOME_COUNTRY (and NEWS_HOME_CITY)" }]
    : [];

  return {
    desks: selected.filter((desk) => desk.id !== "home" || home !== null),
    unconfigured,
  };
}

export interface NewsWindow {
  start: string;
  end: string;
}

const HOUR = 3600_000;
/** The morning run is daily, so a normal window is a day. */
const MIN_WINDOW_HOURS = 24;
/** A weekend or an outage without runs still gets covered, up to this far back. */
const MAX_WINDOW_HOURS = 72;

/**
 * From where the last scan ended to now, never shorter than a day and never longer than three.
 * "The last 24 hours" is only right when yesterday's run happened: after a missed day the reader
 * missed that day's news too, and a fixed window would silently skip it.
 */
export function newsWindow(now: Date, lastScanEnd: Date | null): NewsWindow {
  const earliest = now.getTime() - MAX_WINDOW_HOURS * HOUR;
  const latest = now.getTime() - MIN_WINDOW_HOURS * HOUR;
  const from = lastScanEnd ? Math.min(Math.max(lastScanEnd.getTime(), earliest), latest) : latest;
  return { start: new Date(from).toISOString(), end: now.toISOString() };
}

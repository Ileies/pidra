import { isDateKey } from "../../util/ids";
import type { HomeConfig, NewsWindow } from "../config";
import type { DeskStory, NewsValidation } from "./types";
import { articleKey } from "./url";

/** How far before the window a development may lie and still count, for time zones and a late run. */
const WINDOW_TOLERANCE_MS = 12 * 3600_000;

/**
 * Whether the development falls inside the window. Only staleness is judged: an old story
 * presented as today's is the failure, while a date after the window is an announced event and
 * is left alone. A bare date is read as the whole of that day, in UTC.
 */
export function withinWindow(happenedAt: string, window: NewsWindow): boolean | null {
  const value = happenedAt.trim();
  if (!value) return null;

  const dateOnly = isDateKey(value);
  const parsed = Date.parse(dateOnly ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(parsed)) return null;

  const latestMoment = dateOnly ? parsed + 24 * 3600_000 : parsed;
  return latestMoment >= Date.parse(window.start) - WINDOW_TOLERANCE_MS;
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
  const unverifiedUrls = urls.filter((url) => { const key = articleKey(url); return key === null || !known.has(key); });

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

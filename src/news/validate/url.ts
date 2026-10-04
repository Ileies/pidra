import type { DeskStory } from "./types";

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

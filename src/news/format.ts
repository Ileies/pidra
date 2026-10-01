/**
 * The News section between the editor and the report.
 *
 * Two things are done here in code rather than asked of the model:
 *
 * - **Refs.** The editor cites stories by short ids ("n7") that are mapped back to extraction
 *   UUIDs afterwards. Synthesis transcribing 36-character UUIDs is where dead links came from
 *   (Phase 6's `resolveReportRefs` exists because 3 of 26 once pointed at nothing); a two-character
 *   id does not slip that way.
 * - **Links.** Every link in the section is attached from the stories' checked sources, and any
 *   link the editor wrote itself is removed. So a URL on the report is always one the search
 *   actually returned, never one a model composed.
 *
 * And when the editor call fails outright, `renderNewsFallback` writes the section from the stories
 * directly, so a synthesis hiccup never hides the news. Pure, so all of it is testable.
 */

import { DESKS, type HomeConfig } from "./config";
import type { NewsExtraction } from "./validate";

export interface NewsItem {
  /** The extraction id. */
  id: string;
  story: NewsExtraction;
}

export interface EditorStory {
  id: string;
  desk: NewsExtraction["desk"];
  headline: string;
  summary: string;
  context: string;
  significance: number;
  status: NewsExtraction["status"];
  confidence: NewsExtraction["confidence"];
  region: string;
  topic: string;
  publishers: string[];
}

const deskOrder = (item: NewsItem) => DESKS.findIndex((desk) => desk.id === item.story.desk);

/** Desk order, then most significant first: the order the section itself is written in. */
function ordered(items: NewsItem[]): NewsItem[] {
  return [...items].sort((a, b) => deskOrder(a) - deskOrder(b) || b.story.significance - a.story.significance);
}

/** The editor's view of the stories, and the map from each short id back to its row. */
export function editorStories(items: NewsItem[]): { stories: EditorStory[]; refs: Map<string, NewsItem> } {
  const refs = new Map<string, NewsItem>();
  const stories = ordered(items).map((item, index) => {
    const ref = `n${index + 1}`;
    refs.set(ref, item);
    return {
      id: ref,
      desk: item.story.desk,
      headline: item.story.headline,
      summary: item.story.key_claim,
      context: item.story.context,
      significance: item.story.significance,
      status: item.story.status,
      confidence: item.story.confidence,
      region: item.story.region,
      topic: item.story.topic,
      publishers: [...new Set(item.story.sources.map((s) => s.publisher).filter(Boolean))],
    };
  });
  return { stories, refs };
}

/** The editor's whole input, shared by the pipeline and the dry-run script so the two cannot drift. */
export function editorPayload(
  items: NewsItem[],
  home: HomeConfig | null,
  notesIntel: string[],
  runDate: string,
): { payload: string; refs: Map<string, NewsItem> } {
  const { stories, refs } = editorStories(items);
  const payload = JSON.stringify({
    report_date: runDate,
    stories,
    home: home ? { label: home.label, also_countries: home.also.map((c) => c.name) } : null,
    notes_intel: notesIntel,
  });
  return { payload, refs };
}

/** A URL as a markdown link target: parentheses would end the target early. */
function linkTarget(url: string): string {
  return url.replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/\s/g, "%20");
}

/** Brackets and emphasis markers would break the link or bleed formatting into the line. */
function linkText(text: string): string {
  return text.replace(/[[\]*_`]/g, "").trim();
}

/** Up to three sources across the cited stories, one per publisher, as inline markdown links. */
export function sourceLinks(items: NewsItem[], max = 3): string {
  const seen = new Set<string>();
  const links: string[] = [];
  for (const item of items) {
    for (const source of item.story.sources) {
      const name = linkText(source.publisher) || linkText(new URL(source.url).host.replace(/^www\./, ""));
      const key = name.toLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);
      links.push(`[${name}](${linkTarget(source.url)})`);
      if (links.length === max) return links.join(" · ");
    }
  }
  return links.join(" · ");
}

const REFS = /<!--refs:([^>]*)-->/g;
const SYSTEM_BLOCK = /<!--SYSTEM[\s\S]*?-->/g;
/** Any markdown link the editor wrote. Its text stays; its target was never checked. */
const EDITOR_LINK = /\[([^\]]*)\]\([^)\s]*\)/g;
const NEWS_HEADING = /^#{1,2}\s+news\b.*$/im;
const GROUP_HEADING = /^###\s+(?!#)(.+?)\s*$/;
const BULLET_START = /^(\s{0,3}[-*+]\s+)(.*)$/;

/** `- **Headline.** facts` becomes `- **Label: Headline.** facts`; an unbolded bullet gets its own bold label. */
function labelBullet(line: string, label: string): string {
  const [, marker, rest] = BULLET_START.exec(line)!;
  const name = label.replace(/\*/g, "").trim();
  return rest.startsWith("**") ? `${marker}**${name}: ${rest.slice(2)}` : `${marker}**${name}:** ${rest}`;
}

interface Group {
  heading: string;
  lines: string[];
}

const IN_BRIEF = "In brief";

/** A single-story group's lines with its heading moved into the bullet, blank lines dropped. */
function labelledLines(group: Group): string[] {
  let labelled = false;
  return group.lines.filter((line) => line.trim() !== "").map((line) => {
    if (labelled || !BULLET_START.test(line)) return line;
    labelled = true;
    return labelBullet(line, group.heading);
  });
}

/**
 * A `###` group holding a single story loses its heading, labelled inline instead ("**Talk of
 * the day: ...**"). Asked for by the owner (2026-10-01): one heading per story turned a short
 * section into a column of headings. A lone one joins the group above it; two or more in a row
 * share one "In brief" heading, since three labelled AI, markets and startups stories under the
 * home heading read as home news. The first group always keeps its heading, since there is
 * nothing above it to join.
 */
export function foldSingleStoryGroups(markdown: string): string {
  const preamble: string[] = [];
  const groups: Group[] = [];
  for (const line of markdown.split("\n")) {
    const heading = GROUP_HEADING.exec(line);
    if (heading) groups.push({ heading: heading[1], lines: [] });
    else if (groups.length > 0) groups[groups.length - 1].lines.push(line);
    else preamble.push(line);
  }

  const single = (group: Group) => group.lines.filter((line) => BULLET_START.test(line)).length === 1;
  const kept: Group[] = [];
  for (let i = 0; i < groups.length; i++) {
    if (i === 0 || !single(groups[i])) {
      kept.push(groups[i]);
      continue;
    }
    let end = i;
    while (end + 1 < groups.length && single(groups[end + 1])) end++;
    const run = groups.slice(i, end + 1);
    const lines = run.flatMap(labelledLines);
    if (run.length === 1) {
      const target = kept[kept.length - 1];
      while (target.lines.length > 0 && target.lines[target.lines.length - 1].trim() === "") target.lines.pop();
      target.lines.push(...lines, "");
    } else {
      kept.push({ heading: IN_BRIEF, lines: ["", ...lines, ""] });
    }
    i = end;
  }

  return [...preamble, ...kept.flatMap((group) => [`### ${group.heading}`, ...group.lines])].join("\n").trim();
}

/**
 * The editor's markdown, made safe for the report: its own links removed, short ids mapped to
 * extraction ids (an id that maps to nothing is dropped, like a dead ref in Phase 6), the checked
 * sources linked in, single-story groups folded into labelled bullets, and the `## News` heading
 * the report parser keys on guaranteed.
 */
export function finishNewsSection(markdown: string, refs: Map<string, NewsItem>): string {
  let text = markdown.replace(SYSTEM_BLOCK, "").replace(EDITOR_LINK, "$1").trim();

  text = text.replace(REFS, (_block, inner: string, offset: number, whole: string) => {
    const cited = [
      ...new Map(
        inner
          .split(",")
          .map((ref) => refs.get(ref.trim().toLowerCase()))
          .filter((item): item is NewsItem => item !== undefined)
          .map((item) => [item.id, item]),
      ).values(),
    ];
    if (cited.length === 0) return "";
    const links = sourceLinks(cited);
    // The prompt puts the comment straight after the text, so links need their own space or
    // they read as part of the last word ("irresponsible.The Guardian").
    const gap = links && offset > 0 && !/\s/.test(whole[offset - 1]) ? " " : "";
    return `${links ? `${gap}${links} ` : ""}<!--refs:${cited.map((item) => item.id).join(",")}-->`;
  });

  text = NEWS_HEADING.test(text) ? text.replace(NEWS_HEADING, "## News") : `## News\n\n${text}`;
  return foldSingleStoryGroups(text);
}

const CAPS = { top: 8, home: 6, field: 12, talk: 5, serendipity: 2 };

function bullet(item: NewsItem): string {
  const { story } = item;
  const prefix = story.status === "update" ? "UPDATE: " : story.confidence === "unconfirmed" ? "Unconfirmed: " : "";
  const headline = story.headline.replace(/\*/g, "").trim();
  const links = sourceLinks([item]);
  return `- **${prefix}${headline}** ${story.key_claim}${links ? ` ${links}` : ""} <!--refs:${item.id}-->`;
}

/**
 * The section without the editor: the same groups and caps the editor is told to use, in code.
 * Plainer - no merged duplicates, one heading for all the fields - but complete and correct.
 */
export function renderNewsFallback(items: NewsItem[], home: HomeConfig | null): string {
  if (items.length === 0) return "";

  // Only the hard-news desks can promote a 5 to the top: a 5 on the something-different scale is an
  // extraordinary curiosity, not front-page news (the editor was told the same after a fossil find
  // led the section on the second probe).
  const promotes = new Set<NewsExtraction["desk"]>(["home", "beat", "field"]);
  const sorted = [...items].sort((a, b) => b.story.significance - a.story.significance);
  const top = sorted
    .filter((i) => i.story.desk === "world" || (i.story.significance === 5 && promotes.has(i.story.desk)))
    .slice(0, CAPS.top);
  const rest = sorted.filter((i) => !top.includes(i));
  const byDesk = (desks: NewsExtraction["desk"][], cap: number) =>
    rest.filter((i) => desks.includes(i.story.desk)).slice(0, cap);

  const groups: [string, NewsItem[]][] = [
    ["Top stories", top],
    [home?.label ?? "Home", byDesk(["home"], CAPS.home)],
    ["Your fields", byDesk(["beat", "field"], CAPS.field)],
    ["Talk of the day", byDesk(["talk"], CAPS.talk)],
    ["Something different", byDesk(["serendipity"], CAPS.serendipity)],
  ];

  const body = groups
    .filter(([, group]) => group.length > 0)
    .map(([heading, group]) => `### ${heading}\n\n${group.map(bullet).join("\n")}`)
    .join("\n\n");
  return foldSingleStoryGroups(`## News\n\n${body}`);
}

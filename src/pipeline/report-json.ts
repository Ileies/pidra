/**
 * The report's structured form.
 *
 * The dashboard used to render the briefing as one flat `{@html marked(full_report)}` blob and
 * guess at its shape from CSS. Its structure is not a guess: it is pinned by the synthesis
 * prompts in `../ai/prompts.ts`, which is why the parser lives next to them rather than in the
 * dashboard. Prompt drift is then a one-file fix in the pipeline instead of a silent break in
 * the UI.
 *
 * No second model call: Phase 5 asks for exactly the markdown it asks for today, and this parses
 * that output deterministically in Bun. No extra tokens, no prompt change, and no risk of
 * degrading the prose by also asking the model for JSON.
 *
 * `full_report` stays the source of truth and is never dropped. If this parser fails to find
 * both section headings it returns null, the column stays null, and the dashboard falls back to
 * rendering the markdown as before - a prompt drift degrades the layout instead of emptying the
 * page.
 */

export const REPORT_JSON_VERSION = 1;

export type Urgency = "critical" | "high" | "normal" | "mentions";

export interface ReportEntry {
  /** Markdown fragment. Rendering and sanitising belong to the dashboard, so no HTML here. */
  md: string;
  /** Extraction ids this entry was anchored to, taken out of the `<!--refs:-->` comment. */
  refIds: string[];
}

export interface ReportJson {
  version: typeof REPORT_JSON_VERSION;
  date: string;
  /** Section 2, which the dashboard renders first at every width: it is the actionable half. */
  personal: { urgency: Urgency; entries: ReportEntry[] }[];
  /** Section 1. */
  intel: { domain: string; entries: ReportEntry[] }[];
  alsoNoted: ReportEntry[];
}

const SYSTEM_BLOCK = /<!--SYSTEM[\s\S]*?-->/g;
const REFS = /<!--refs:([^>]*)-->/g;

/** `### High priority` and friends. The prompt fixes these four; anything else lands in normal. */
const URGENCIES: [RegExp, Urgency][] = [
  [/^critical$/i, "critical"],
  [/^high(\s+priority)?$/i, "high"],
  [/^normal$/i, "normal"],
  [/^mentions$/i, "mentions"],
];

const ALSO_NOTED = /^also noted$/i;
const BULLET = /^\s{0,3}([-*+]|\d+[.)])\s+/;
/** A markdown horizontal rule and nothing else. */
const RULE_ONLY = /^\s*([-*_])(\s*\1){2,}\s*$/;

interface Block {
  /** The `##` this block sits under, verbatim. */
  section: string;
  /** The `###` this block sits under, or "" when the content is directly under the `##`. */
  heading: string;
  lines: string[];
}

/** Splits the report into `## / ###` regions, preserving order. */
function blocks(markdown: string): Block[] {
  const out: Block[] = [];
  let section = "";
  let heading = "";
  let lines: string[] = [];

  const flush = () => {
    if (lines.some((line) => line.trim() !== "")) out.push({ section, heading, lines });
    lines = [];
  };

  for (const line of markdown.split("\n")) {
    const h2 = /^##\s+(?!#)(.+?)\s*$/.exec(line);
    const h3 = /^###\s+(?!#)(.+?)\s*$/.exec(line);
    if (h2) {
      flush();
      section = h2[1];
      heading = "";
      continue;
    }
    if (h3) {
      flush();
      heading = h3[1];
      continue;
    }
    lines.push(line);
  }
  flush();
  return out;
}

/**
 * One entry per bullet or per paragraph, which is the granularity the prompt anchors refs at.
 * Indented continuation lines stay with the bullet that owns them.
 */
function entries(lines: string[]): ReportEntry[] {
  const chunks: string[][] = [];
  let current: string[] = [];

  const push = () => {
    if (current.some((line) => line.trim() !== "")) chunks.push(current);
    current = [];
  };

  for (const line of lines) {
    if (line.trim() === "") {
      push();
      continue;
    }
    // A new top-level bullet ends the previous entry; an indented one is a continuation.
    if (BULLET.test(line) && !/^\s{4,}/.test(line) && current.length > 0) push();
    current.push(line);
  }
  push();

  return chunks
    .map((chunk) => {
      const raw = chunk.join("\n").trim();
      const refIds = [
        ...new Set(
          [...raw.matchAll(REFS)].flatMap((match) =>
            match[1].split(",").map((id) => id.trim()).filter(Boolean),
          ),
        ),
      ];
      // The refs comment is metadata, not prose: it is stripped here so the dashboard renders an
      // entry and its "More on this" affordance separately rather than parsing HTML comments.
      const md = raw.replace(REFS, "").replace(/[ \t]+$/gm, "").trim();
      return { md, refIds };
    })
    // Phase 6 joins the two sections with a `---` rule, which otherwise arrives as a content-free
    // entry at the end of Section 2.
    .filter((entry) => entry.md !== "" && !RULE_ONLY.test(entry.md));
}

function urgencyFor(heading: string): Urgency {
  for (const [pattern, urgency] of URGENCIES) {
    if (pattern.test(heading.trim())) return urgency;
  }
  return "normal";
}

/**
 * Parses a resolved report - the string Phase 6 writes to `daily_reports.full_report`, after
 * `resolveReportRefs` has dropped ids that point at nothing.
 *
 * Returns null when either section heading is missing, which is the signal that the prompt and
 * this parser have drifted apart.
 */
export function parseReport(fullReport: string, date: string): ReportJson | null {
  const markdown = fullReport.replace(SYSTEM_BLOCK, "");

  const parsed = blocks(markdown);
  const hasPersonal = parsed.some((block) => /personal action center/i.test(block.section));
  const hasIntel = parsed.some((block) => /intelligence briefing/i.test(block.section));
  if (!hasPersonal || !hasIntel) return null;

  const personal = new Map<Urgency, ReportEntry[]>();
  const intel = new Map<string, ReportEntry[]>();
  const alsoNoted: ReportEntry[] = [];

  for (const block of parsed) {
    const items = entries(block.lines);
    if (items.length === 0) continue;

    if (ALSO_NOTED.test(block.heading)) {
      alsoNoted.push(...items);
      continue;
    }

    if (/personal action center/i.test(block.section)) {
      const urgency = urgencyFor(block.heading);
      personal.set(urgency, [...(personal.get(urgency) ?? []), ...items]);
      continue;
    }

    if (/intelligence briefing/i.test(block.section)) {
      // Content directly under the `##`, before any domain heading, is still Section 1 content;
      // dropping it would lose a lead paragraph silently.
      const domain = block.heading || "Briefing";
      intel.set(domain, [...(intel.get(domain) ?? []), ...items]);
    }
  }

  // Fixed order, so the dashboard never has to sort by urgency itself.
  const ORDER: Urgency[] = ["critical", "high", "normal", "mentions"];

  return {
    version: REPORT_JSON_VERSION,
    date,
    personal: ORDER.filter((urgency) => personal.has(urgency)).map((urgency) => ({
      urgency,
      entries: personal.get(urgency)!,
    })),
    intel: [...intel.entries()].map(([domain, list]) => ({ domain, entries: list })),
    alsoNoted,
  };
}

import { isDateKey } from "../src/util/ids";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import type { Skill } from "../src/skills/loader";
import { db, dailyReports, extractions, rawItems } from "../src/db";
import { searchReports, tokenize } from "../src/context/lookup";
import { isLocalDate } from "../src/util/time";

const SECTIONS = ["full", "summary", "sources"] as const;
const MAX_LIMIT = 10;
const MAX_RECENT = 60;
const DEFAULT_MAX_CHARS = 20000;
const MAX_CHARS_CEILING = 60000;

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (value === undefined || value === null || value === "" || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function optionalDate(value: unknown, name: string): string | undefined {
  const text = String(value ?? "").trim();
  if (!text) return undefined;
  if (!isLocalDate(text)) throw new Error(`${name} must be YYYY-MM-DD (got "${text}")`);
  return text;
}

/**
 * Read-only, and deliberately the *only* skill that touches a report. Reports are final: the
 * pipeline writes them, nothing else does. This exists so the assistant can talk about what the
 * user is reading without the client having to ship the whole briefing into the prompt every turn.
 */
const skill: Skill = {
  name: "read_report",
  description:
    "Read a daily briefing. Returns the report text and what went into it. Pass query to instead " +
    "search all past briefings for a name or topic (every word must appear) and get the matching " +
    "dates with an excerpt, then read one by date. Read-only: reports are final and cannot be " +
    "edited - act on notes, todos, the calendar or the long-term context instead.",
  risk_level: "low",
  parameters: {
    date: { type: "string", required: false, description: "Report date as YYYY-MM-DD, or 'latest' (default: the most recent report)" },
    section: {
      type: "string",
      required: false,
      description: `One of ${SECTIONS.join(" | ")}. 'full' (default) is the report text plus its sources, 'summary' just the short summary, 'sources' only the sources line`,
    },
    query: { type: "string", required: false, description: "Search past briefings instead of reading one: matching dates plus an excerpt each, newest first" },
    from: { type: "string", required: false, description: "With query or recent: only briefings on or after this date, YYYY-MM-DD. Default: no lower bound" },
    to: { type: "string", required: false, description: "With query or recent: only briefings on or before this date, YYYY-MM-DD. Default: no upper bound" },
    limit: { type: "number", required: false, description: `With query: how many matching briefings to return, 1 to ${MAX_LIMIT}. Default: 5` },
    recent: {
      type: "number",
      required: false,
      description: `List the N newest briefings (date and short summary) instead of reading one, 1 to ${MAX_RECENT}. Use it to find which dates exist`,
    },
    max_chars: { type: "number", required: false, description: `Cut the report text after this many characters, 500 to ${MAX_CHARS_CEILING}. Default: ${DEFAULT_MAX_CHARS}` },
  },
  execute: async (params) => {
    const from = optionalDate(params.from, "from");
    const to = optionalDate(params.to, "to");
    if (from && to && to < from) throw new Error("to must not be before from");

    const query = params.query ? String(params.query).trim() : "";
    if (query) {
      const hits = await searchReports(query, { from, to, limit: clampInt(params.limit, 5, 1, MAX_LIMIT) });
      if (hits.length === 0) {
        const range = from || to ? ` between ${from ?? "the start"} and ${to ?? "today"}` : "";
        return `No briefing${range} contains all of: ${tokenize(query).join(", ")}. Try fewer or shorter words${range ? " or a wider date range" : ""}.`;
      }
      return hits.map((h) => `Briefing ${h.date}\n${h.excerpt}`).join("\n\n---\n\n");
    }

    if (params.recent !== undefined && params.recent !== null && params.recent !== "") {
      const count = clampInt(params.recent, 10, 1, MAX_RECENT);
      const conditions = [from ? gte(dailyReports.reportDate, from) : undefined, to ? lte(dailyReports.reportDate, to) : undefined];
      const rows = await db
        .select({ date: dailyReports.reportDate, summary: dailyReports.shortSummary })
        .from(dailyReports)
        .where(and(...conditions))
        .orderBy(desc(dailyReports.reportDate))
        .limit(count);
      if (rows.length === 0) return "No briefings in that range.";
      return rows.map((r) => `Briefing ${r.date}: ${r.summary ?? "(no summary)"}`).join("\n\n");
    }

    const rawDate = params.date ? String(params.date).trim() : "";
    const date = rawDate.toLowerCase() === "latest" ? "" : rawDate;
    if (date && !isDateKey(date)) throw new Error("date must be YYYY-MM-DD or 'latest'");

    const section = String(params.section ?? "full").trim().toLowerCase();
    if (!(SECTIONS as readonly string[]).includes(section)) {
      throw new Error(`section must be one of ${SECTIONS.join(", ")} (got "${section}")`);
    }
    const maxChars = clampInt(params.max_chars, DEFAULT_MAX_CHARS, 500, MAX_CHARS_CEILING);

    const [report] = date
      ? await db.select().from(dailyReports).where(eq(dailyReports.reportDate, date)).limit(1)
      : await db.select().from(dailyReports).orderBy(desc(dailyReports.reportDate)).limit(1);

    if (!report) return date ? `No report for ${date}.` : "No reports yet.";

    if (section === "summary") {
      return `Briefing ${report.reportDate} (summary):\n${report.shortSummary ?? "(no summary)"}`;
    }

    // What the report was built from, so the assistant can answer "where did that come from"
    // without a second call. Capped: this is context for a conversation, not a data dump.
    const items = await db
      .select({
        source: rawItems.sourceName,
        sourceType: rawItems.sourceType,
        included: extractions.includedInReport,
        relevance: extractions.effectiveRelevance,
      })
      .from(extractions)
      .leftJoin(rawItems, eq(rawItems.id, extractions.rawItemId))
      .where(eq(extractions.runDate, report.reportDate))
      .limit(200);

    // `included_in_report` is only set when Phase 6 could parse the report's own refs markers.
    // When it could not, the relevance threshold is the same fallback Phase 6 uses, and the
    // wording says which of the two this is rather than claiming zero items made it in.
    const flagged = items.filter((item) => item.included);
    const included = flagged.length > 0 ? flagged : items.filter((item) => (item.relevance ?? 0) >= 3);
    const basis = flagged.length > 0 ? "marked as included" : "estimated from relevance >= 3";
    const sources = [...new Set(included.map((item) => item.source).filter(Boolean))].slice(0, 40);

    const header = [
      `Briefing ${report.reportDate}`,
      `${included.length} of ${items.length} items (${basis}). Sources: ${sources.join(", ") || "none"}`,
    ];
    if (section === "sources") return header.join("\n");

    const text = report.fullReport ?? "(no report text)";
    const cut = text.length > maxChars ? `\n\n(cut after ${maxChars} of ${text.length} characters; raise max_chars for more)` : "";
    return [...header, "", text.slice(0, maxChars)].join("\n") + cut;
  },
};

export default skill;

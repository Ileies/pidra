import { desc, eq } from "drizzle-orm";
import type { Skill } from "../src/skills/loader";
import { db, dailyReports, extractions, rawItems } from "../src/db";
import { searchReports, tokenize } from "../src/context/lookup";

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
    date: { type: "string", required: false, description: "Report date as YYYY-MM-DD (default: the most recent report)" },
    section: { type: "string", required: false, description: "'full' (default) or 'summary' for just the short summary" },
    query: { type: "string", required: false, description: "Search past briefings instead of reading one: matching dates plus an excerpt each, newest first" },
  },
  execute: async (params) => {
    const query = params.query ? String(params.query).trim() : "";
    if (query) {
      const hits = await searchReports(query);
      if (hits.length === 0) return `No briefing contains all of: ${tokenize(query).join(", ")}. Try fewer or shorter words.`;
      return hits.map((h) => `Briefing ${h.date}\n${h.excerpt}`).join("\n\n---\n\n");
    }

    const date = params.date ? String(params.date).trim() : "";
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("date must be YYYY-MM-DD");

    const [report] = date
      ? await db.select().from(dailyReports).where(eq(dailyReports.reportDate, date)).limit(1)
      : await db.select().from(dailyReports).orderBy(desc(dailyReports.reportDate)).limit(1);

    if (!report) return date ? `No report for ${date}.` : "No reports yet.";

    if (String(params.section ?? "full") === "summary") {
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

    return [
      `Briefing ${report.reportDate}`,
      `${included.length} of ${items.length} items (${basis}). Sources: ${sources.join(", ") || "none"}`,
      "",
      (report.fullReport ?? "(no report text)").slice(0, 20000),
    ].join("\n");
  },
};

export default skill;

/**
 * The command palette's search while pronix is out of reach. Online the
 * palette asks `/api/search`, which ranks with Postgres `tsvector`; offline it asks this, which
 * matches plain text over what the mirror holds: reports, notes, standing rules and entities. The
 * palette says which one answered, because the two do not find the same things - no stemming, no
 * ranking beyond a count, and only the mirrored window.
 *
 * A local index is not worth it at this size (60 reports, a few hundred other rows); the
 * semantic-search project in `TODO.md` is where that conversation belongs.
 */

import * as db from "./db.js";
import type { MirroredEntity, MirroredReport, MirroredRule } from "./repo.js";
import type { NoteRow } from "#lib/notes/api.js";

export type OfflineHitKind = "report" | "note" | "rule" | "entity";

export interface OfflineHit {
  id: string;
  kind: OfflineHitKind;
  title: string;
  /** The text around the first match, split so the page can mark it without `{@html}`. */
  snippet: { before: string; match: string; after: string } | null;
  href: string;
  meta: string;
  score: number;
}

/** The same term split as the server's `toTsQuery`, so a query means roughly the same thing. */
function termsOf(raw: string): string[] {
  return raw
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length > 1)
    .slice(0, 8);
}

/** Every term somewhere in the text (AND, like the server), scored by how often they occur. */
function score(haystack: string, terms: string[]): number {
  let total = 0;
  for (const term of terms) {
    let count = 0;
    for (let at = haystack.indexOf(term); at !== -1; at = haystack.indexOf(term, at + term.length)) count++;
    if (count === 0) return 0;
    total += count;
  }
  return total;
}

const CONTEXT = 60;

function snippetOf(text: string, lower: string, terms: string[]): OfflineHit["snippet"] {
  const positions = terms.map((term) => ({ term, at: lower.indexOf(term) })).filter((p) => p.at !== -1);
  if (positions.length === 0) return null;
  const first = positions.reduce((a, b) => (b.at < a.at ? b : a));
  const start = Math.max(0, first.at - CONTEXT);
  const end = Math.min(text.length, first.at + first.term.length + CONTEXT);
  return {
    before: (start > 0 ? "…" : "") + text.slice(start, first.at),
    match: text.slice(first.at, first.at + first.term.length),
    after: text.slice(first.at + first.term.length, end) + (end < text.length ? "…" : ""),
  };
}

/** Rendered report HTML as text. DOMParser builds an inert document: nothing in it runs. */
const reportText = new Map<string, { key: string; text: string }>();

function textOfReport(report: MirroredReport): string {
  const key = `${report.report?.createdAt ?? ""}:${report.reportHtml?.length ?? 0}`;
  const cached = reportText.get(report.id);
  if (cached?.key === key) return cached.text;

  const s = report.structured;
  const html = s
    ? [
        ...s.personal.flatMap((g) => g.entries),
        ...(s.news ?? []).flatMap((g) => g.entries),
        ...s.intel.flatMap((g) => g.entries),
        ...s.alsoNoted,
      ]
        .map((e) => e.html)
        .join("\n")
    : (report.reportHtml ?? "");
  const text = (new DOMParser().parseFromString(html, "text/html").body.textContent ?? "").replace(/\s+/g, " ").trim();
  reportText.set(report.id, { key, text });
  return text;
}

export async function searchMirror(query: string, limit = 20): Promise<OfflineHit[]> {
  const terms = termsOf(query);
  if (terms.length === 0) return [];

  const [reports, notes, rules, entities] = await Promise.all([
    db.getAll<MirroredReport>("reports"),
    db.getAll<NoteRow>("notes"),
    db.getAll<MirroredRule>("rules"),
    db.getAll<MirroredEntity>("entities"),
  ]);

  const hits: OfflineHit[] = [];
  const consider = (hit: Omit<OfflineHit, "score" | "snippet">, text: string) => {
    const lower = text.toLowerCase();
    const found = score(lower, terms);
    if (found > 0) hits.push({ ...hit, score: found, snippet: snippetOf(text, lower, terms) });
  };

  for (const report of reports) {
    consider({ id: report.id, kind: "report", title: report.date, href: `/${report.date}`, meta: "Report" }, textOfReport(report));
  }
  for (const note of notes) {
    if (note.deleted_at) continue;
    consider(
      { id: note.id, kind: "note", title: note.content.slice(0, 60) || "Note", href: `/notes?q=${encodeURIComponent(query)}`, meta: `Note · ${note.scope}` },
      note.content,
    );
  }
  for (const rule of rules) {
    consider({ id: rule.id, kind: "rule", title: rule.key, href: "/rules", meta: "Standing rule" }, `${rule.key} ${rule.value}`);
  }
  for (const entity of entities) {
    consider(
      { id: entity.id, kind: "entity", title: entity.name, href: `/entities/${entity.id}`, meta: entity.type ?? "Entity" },
      [entity.name, ...entity.aliases, entity.summary ?? ""].join(" "),
    );
  }

  // Most matches first; among equals, the newest report and then the order above.
  return hits
    .sort((a, b) => b.score - a.score || (a.kind === "report" && b.kind === "report" ? b.id.localeCompare(a.id) : 0))
    .slice(0, limit);
}

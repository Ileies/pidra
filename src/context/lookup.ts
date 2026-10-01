import { db, standingContext, entities, contacts, contextCorrections, dailyReports } from "../db";
import { desc, eq, sql as drizzleSql, type SQL } from "drizzle-orm";
import { loadLongTermContext } from "../pipeline/long-term-context";

/**
 * Read side of the context revision loop: what the chat looks at before proposing a correction.
 * Keyword lookup against Postgres and the context document on disk - no vector store, per the
 * architecture rules.
 */

export interface ContextHit {
  kind: "document" | "standing_context" | "entity" | "contact" | "correction";
  key: string;
  text: string;
}

const MAX_PER_KIND = 8;
const EXCERPT_CHARS = 700;

/**
 * A query is its words, not one literal phrase: "OCG Akademie" has to find a row that says
 * "Akademie der OCG". Every word must appear somewhere in the row (AND), in any order.
 */
export function tokenize(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

function escapeLike(token: string): string {
  return token.replace(/[\\%_]/g, "\\$&");
}

/** SQL for "every token appears in at least one of these columns". No tokens matches everything. */
export function matchAllTokens(columns: SQL[], tokens: string[]): SQL {
  if (tokens.length === 0) return drizzleSql`true`;
  const perToken = tokens.map((token) => {
    const like = `%${escapeLike(token)}%`;
    const anyColumn = drizzleSql.join(
      columns.map((c) => drizzleSql`lower(coalesce(${c}, '')) LIKE ${like}`),
      drizzleSql` OR `,
    );
    return drizzleSql`(${anyColumn})`;
  });
  return drizzleSql`(${drizzleSql.join(perToken, drizzleSql` AND `)})`;
}

/**
 * Document hits are returned as whole `##` subsections rather than matching lines. A correction
 * needs its `target_key` to be a heading that exists, and a bare matching line does not tell the
 * caller which heading it came from.
 */
function searchDocument(doc: string, tokens: string[]): ContextHit[] {
  if (!doc) return [];
  const hits: ContextHit[] = [];
  let heading = "(document preamble)";

  for (const block of doc.split(/^(?=#{1,3} )/m)) {
    const first = block.split("\n", 1)[0];
    if (/^#{1,3} /.test(first)) heading = first.replace(/^#+\s*/, "").trim();
    const lowered = block.toLowerCase();
    if (!tokens.every((t) => lowered.includes(t))) continue;
    hits.push({ kind: "document", key: heading, text: block.trim().slice(0, EXCERPT_CHARS) });
    if (hits.length >= MAX_PER_KIND) break;
  }
  return hits;
}

export async function searchContext(query: string, kind?: string): Promise<ContextHit[]> {
  const raw = query.trim().toLowerCase();
  if (!raw) return [];

  // "list everything of this kind" - the review case, e.g. reading the standing rules through
  // before correcting them. Without it the caller has to guess a word that happens to match.
  const listAll = raw === "*" || raw === "all";
  const tokens = listAll ? [] : tokenize(raw);

  const want = (k: string) => !kind || kind === "all" || kind === k;
  const hits: ContextHit[] = [];

  // Listing every block of the document is what `documentOutline` is for, so a bare "all" only
  // enumerates the other kinds.
  if (want("document") && !listAll) {
    const ctx = await loadLongTermContext();
    // Both halves, joined: the split is a daily-prompt concern, not a lookup concern.
    hits.push(...searchDocument([ctx.personalSections, ctx.intelSections].filter(Boolean).join("\n\n"), tokens));
  }

  if (want("standing_context")) {
    const rows = await db
      .select({ key: standingContext.key, value: standingContext.value, source: standingContext.source })
      .from(standingContext)
      .where(matchAllTokens([drizzleSql`${standingContext.value}`, drizzleSql`${standingContext.key}`], tokens))
      // Standing rules are the one kind a user reviews in full, and there are tens of them.
      .limit(listAll ? 100 : MAX_PER_KIND);
    hits.push(...rows.map((r) => ({
      kind: "standing_context" as const,
      key: r.key,
      text: `[${r.source}] ${r.value.slice(0, EXCERPT_CHARS)}`,
    })));
  }

  if (want("entity")) {
    const rows = await db
      .select({ name: entities.name, type: entities.type, summary: entities.summary, importance: entities.importance, locked: entities.locked })
      .from(entities)
      .where(matchAllTokens([drizzleSql`${entities.name}`, drizzleSql`${entities.summary}`], tokens))
      .orderBy(desc(entities.mentionCount))
      .limit(MAX_PER_KIND);
    hits.push(...rows.map((r) => ({
      kind: "entity" as const,
      key: r.name,
      text: `type=${r.type ?? "-"} importance=${r.importance ?? "-"}${r.locked ? " locked" : ""} - ${r.summary ?? "no summary"}`,
    })));
  }

  if (want("contact")) {
    const rows = await db
      .select({ identifier: contacts.identifier, name: contacts.name, relationship: contacts.relationship, priority: contacts.priority, locked: contacts.locked })
      .from(contacts)
      .where(matchAllTokens([drizzleSql`${contacts.identifier}`, drizzleSql`${contacts.name}`, drizzleSql`${contacts.relationship}`], tokens))
      .limit(MAX_PER_KIND);
    hits.push(...rows.map((r) => ({
      kind: "contact" as const,
      key: r.identifier,
      text: `${r.name ?? "unnamed"} - relationship=${r.relationship ?? "-"} priority=${r.priority ?? "-"}${r.locked ? " locked" : ""}`,
    })));
  }

  if (want("correction")) {
    const rows = await db
      .select()
      .from(contextCorrections)
      .where(drizzleSql`${contextCorrections.status} = 'active' AND ${matchAllTokens([drizzleSql`${contextCorrections.statement}`, drizzleSql`${contextCorrections.targetKey}`], tokens)}`)
      .orderBy(desc(contextCorrections.createdAt))
      .limit(MAX_PER_KIND);
    hits.push(...rows.map((r) => ({
      kind: "correction" as const,
      key: `${r.id} (${r.targetKind}:${r.targetKey})`,
      text: `${r.operation}: ${r.statement}`,
    })));
  }

  return hits;
}

export interface ReportHit {
  date: string;
  excerpt: string;
}

const REPORT_EXCERPT_CHARS = 500;
const MAX_REPORT_HITS = 5;

/** Past briefings containing every word of the query, newest first, each with a window around the first hit. */
export async function searchReports(query: string): Promise<ReportHit[]> {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  const rows = await db
    .select({ date: dailyReports.reportDate, text: dailyReports.fullReport })
    .from(dailyReports)
    .where(matchAllTokens([drizzleSql`${dailyReports.fullReport}`], tokens))
    .orderBy(desc(dailyReports.reportDate))
    .limit(MAX_REPORT_HITS);

  return rows.map((r) => {
    const text = r.text ?? "";
    const at = Math.max(0, text.toLowerCase().indexOf(tokens[0]));
    const start = Math.max(0, at - REPORT_EXCERPT_CHARS / 4);
    return { date: r.date, excerpt: text.slice(start, start + REPORT_EXCERPT_CHARS).trim() };
  });
}

/** The document's heading list, so the chat can name a real `target_key` for a document correction. */
export async function documentOutline(): Promise<string[]> {
  const ctx = await loadLongTermContext();
  return [ctx.personalSections, ctx.intelSections]
    .filter(Boolean)
    .join("\n")
    .split("\n")
    .filter((l) => /^#{1,3} /.test(l))
    .map((l) => l.replace(/^#+\s*/, "").trim());
}

export async function recentCorrections(limit = 20) {
  return db
    .select()
    .from(contextCorrections)
    .where(eq(contextCorrections.status, "active"))
    .orderBy(desc(contextCorrections.createdAt))
    .limit(limit);
}

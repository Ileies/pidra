import { db, standingContext, entities, contacts, contextCorrections } from "../db";
import { desc, eq, sql as drizzleSql } from "drizzle-orm";
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
 * Document hits are returned as whole `##` subsections rather than matching lines. A correction
 * needs its `target_key` to be a heading that exists, and a bare matching line does not tell the
 * caller which heading it came from.
 */
function searchDocument(doc: string, needle: string): ContextHit[] {
  if (!doc) return [];
  const hits: ContextHit[] = [];
  let heading = "(document preamble)";

  for (const block of doc.split(/^(?=#{1,3} )/m)) {
    const first = block.split("\n", 1)[0];
    if (/^#{1,3} /.test(first)) heading = first.replace(/^#+\s*/, "").trim();
    if (!block.toLowerCase().includes(needle)) continue;
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
  const needle = listAll ? "" : raw;

  const want = (k: string) => !kind || kind === "all" || kind === k;
  const like = `%${needle}%`;
  const hits: ContextHit[] = [];

  // Listing every block of the document is what `documentOutline` is for, so a bare "all" only
  // enumerates the other kinds.
  if (want("document") && !listAll) {
    const ctx = await loadLongTermContext();
    // Both halves, joined: the split is a daily-prompt concern, not a lookup concern.
    hits.push(...searchDocument([ctx.personalSections, ctx.intelSections].filter(Boolean).join("\n\n"), needle));
  }

  if (want("standing_context")) {
    const rows = await db
      .select({ key: standingContext.key, value: standingContext.value, source: standingContext.source })
      .from(standingContext)
      .where(drizzleSql`lower(${standingContext.value}) LIKE ${like} OR lower(${standingContext.key}) LIKE ${like}`)
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
      .where(drizzleSql`lower(${entities.name}) LIKE ${like} OR lower(coalesce(${entities.summary}, '')) LIKE ${like}`)
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
      .where(drizzleSql`lower(${contacts.identifier}) LIKE ${like} OR lower(coalesce(${contacts.name}, '')) LIKE ${like} OR lower(coalesce(${contacts.relationship}, '')) LIKE ${like}`)
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
      .where(drizzleSql`${contextCorrections.status} = 'active' AND (lower(${contextCorrections.statement}) LIKE ${like} OR lower(${contextCorrections.targetKey}) LIKE ${like})`)
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

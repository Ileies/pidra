import type { PageServerLoad } from "./$types";
import { error } from "@sveltejs/kit";
import { sql } from "#lib/db.js";
import { UUID_RE } from "#lib/server/extractions.js";

/**
 * Entity detail (D2).
 *
 * /entities was a flat table with no detail page, so `entity_relations` and `entity_appearances`
 * - the two tables that make it a graph rather than a list - had no UI at all. This is also the
 * natural target for a row tap on a phone, where most of the table's columns are hidden anyway.
 *
 * Relations are directed in the schema but read in both directions here: "who does this entity
 * relate to" is the question, and an edge stored the other way round is the same edge.
 */

export interface Relation {
  id: string;
  otherId: string;
  otherName: string;
  otherType: string | null;
  relationType: string | null;
  confidence: number | null;
  direction: "out" | "in";
  firstSeen: string | null;
  lastSeen: string | null;
  confirmed: boolean;
}

export interface Appearance {
  id: string;
  reportDate: string | null;
  contextSnippet: string | null;
  relevanceScore: number | null;
  /** True when a report exists for that day, so the timeline only links where there is one. */
  hasReport: boolean;
}

export const load: PageServerLoad = async ({ params }) => {
  const { id } = params;
  if (!UUID_RE.test(id)) error(404, "Not found");

  const db = sql();

  const [entity] = await db`
    SELECT id, name, aliases, type, domain, summary, first_seen::text AS first_seen,
           last_mentioned::text AS last_mentioned, mention_count, status, importance, locked
    FROM entities
    WHERE id = ${id}
  `;
  if (!entity) error(404, "Entity not found");

  const [relationRows, appearanceRows] = await Promise.all([
    db`
      SELECT r.id, r.relation_type, r.confidence, r.first_seen::text AS first_seen,
             r.last_seen::text AS last_seen, r.confirmed,
             CASE WHEN r.from_id = ${id} THEN 'out' ELSE 'in' END AS direction,
             other.id AS other_id, other.name AS other_name, other.type AS other_type
      FROM entity_relations r
      JOIN entities other ON other.id = CASE WHEN r.from_id = ${id} THEN r.to_id ELSE r.from_id END
      WHERE r.from_id = ${id} OR r.to_id = ${id}
      ORDER BY r.confidence DESC NULLS LAST, other.name
      LIMIT 100
    `,
    db`
      SELECT a.id, a.report_date::text AS report_date, a.context_snippet, a.relevance_score,
             (d.report_date IS NOT NULL) AS has_report
      FROM entity_appearances a
      LEFT JOIN daily_reports d ON d.report_date = a.report_date
      WHERE a.entity_id = ${id}
      ORDER BY a.report_date DESC NULLS LAST
      LIMIT 200
    `,
  ]);

  return {
    entity: {
      id: entity.id as string,
      name: entity.name as string,
      aliases: (entity.aliases as string[] | null) ?? [],
      type: (entity.type as string | null) ?? null,
      domain: (entity.domain as string | null) ?? null,
      summary: (entity.summary as string | null) ?? null,
      firstSeen: (entity.first_seen as string | null) ?? null,
      lastMentioned: (entity.last_mentioned as string | null) ?? null,
      mentionCount: (entity.mention_count as number | null) ?? 0,
      status: (entity.status as string | null) ?? "active",
      importance: (entity.importance as string | null) ?? "normal",
      locked: !!entity.locked,
    },
    relations: relationRows.map((row) => ({
      id: row.id as string,
      otherId: row.other_id as string,
      otherName: row.other_name as string,
      otherType: (row.other_type as string | null) ?? null,
      relationType: (row.relation_type as string | null) ?? null,
      confidence: (row.confidence as number | null) ?? null,
      direction: row.direction as "out" | "in",
      firstSeen: (row.first_seen as string | null) ?? null,
      lastSeen: (row.last_seen as string | null) ?? null,
      confirmed: !!row.confirmed,
    })) as Relation[],
    appearances: appearanceRows.map((row) => ({
      id: row.id as string,
      reportDate: (row.report_date as string | null) ?? null,
      contextSnippet: (row.context_snippet as string | null) ?? null,
      relevanceScore: (row.relevance_score as number | null) ?? null,
      hasReport: !!row.has_report,
    })) as Appearance[],
  };
};

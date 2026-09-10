import { db, dailyReports, activeTopics, entities, entityRelations, contacts, notes, extractions, rawItems, sourceDailyScores, sourceQuality, skillExecutions } from "../db";
import { eq, gte, and, inArray, sql as drizzleSql } from "drizzle-orm";
import type { SynthesisResult } from "./phase5-synthesis";
import { getSkill } from "../skills/loader";

const avg = (nums: number[]) => nums.reduce((s, v) => s + v, 0) / nums.length;

// Synthesis anchors each claim back to the extractions it came from with `<!--refs:id,id-->`,
// which the dashboard turns into a "Mehr dazu" deep link. Nothing used to check that the ids
// were real: on the first full run, 3 of 26 pointed at nothing (one mis-transcribed UUID, two
// invented outright), so those links were dead on arrival.
const REF_BLOCK_RE = /<!--refs:([^>]*)-->/g;

/** Levenshtein distance test that bails out as soon as it is certain the limit is exceeded. */
function withinEditDistance(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur: number[] = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return false;
    prev = cur;
  }
  return prev[b.length] <= max;
}

/**
 * Rewrites every `<!--refs:-->` block so it only contains ids that resolve to a real extraction
 * from this run, and returns the surviving ids. A one-character transcription slip is repaired
 * when exactly one real id is within a single edit; anything else is dropped, because a link to
 * nothing is worse than no link.
 */
async function resolveReportRefs(
  report: string,
  runDate: string,
): Promise<{ report: string; includedIds: string[] }> {
  const candidates = new Set<string>();
  for (const match of report.matchAll(REF_BLOCK_RE)) {
    for (const raw of match[1].split(",")) {
      const id = raw.trim();
      if (id) candidates.add(id);
    }
  }
  if (candidates.size === 0) {
    console.warn("[Phase 6] Report carries no <!--refs:--> anchors - no deep links, no include data");
    return { report, includedIds: [] };
  }

  const rows = await db
    .select({ id: extractions.id })
    .from(extractions)
    .where(eq(extractions.runDate, runDate));
  const real = new Map(rows.map((r) => [r.id.toLowerCase(), r.id]));
  const realHex = [...real.keys()].map((id) => ({ id, hex: id.replace(/-/g, "") }));

  const resolved = new Map<string, string | null>();
  let repaired = 0;
  for (const candidate of candidates) {
    const exact = real.get(candidate.toLowerCase());
    if (exact) {
      resolved.set(candidate, exact);
      continue;
    }
    const hex = candidate.toLowerCase().replace(/[^0-9a-f]/g, "");
    const near = realHex.filter((r) => withinEditDistance(hex, r.hex, 1));
    if (near.length === 1) {
      resolved.set(candidate, real.get(near[0].id)!);
      repaired++;
    } else {
      resolved.set(candidate, null);
    }
  }

  const dropped = [...resolved].filter(([, target]) => target === null).map(([id]) => id);
  const cleaned = report.replace(REF_BLOCK_RE, (_block, inner: string) => {
    const kept = [
      ...new Set(
        inner
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .map((id) => resolved.get(id))
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    return kept.length > 0 ? `<!--refs:${kept.join(",")}-->` : "";
  });

  const includedIds = [...new Set([...resolved.values()].filter((id): id is string => Boolean(id)))];
  console.log(
    `[Phase 6] Report refs: ${candidates.size} cited, ${includedIds.length} resolved` +
      (repaired > 0 ? `, ${repaired} repaired` : "") +
      (dropped.length > 0 ? `, ${dropped.length} dropped` : ""),
  );
  if (dropped.length > 0) {
    console.warn(`[Phase 6] Unresolvable refs removed from the report: ${dropped.join(", ")}`);
  }

  return { report: cleaned, includedIds };
}

function parseSystemBlock(text: string): Record<string, any> | null {
  const match = text.match(/<!--SYSTEM\s*([\s\S]*?)\s*-->/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

export async function runPhase6(
  runDate: string,
  synthesis: SynthesisResult,
  itemCount: number,
  itemsIncluded: number,
  questionGateFired = false,
  webSearchesRun = 0,
): Promise<string> {
  console.log("[Phase 6] Writing memory and report");

  const rawReport = `# Morning Briefing - ${runDate}\n\n---\n\n${synthesis.section1}\n\n---\n\n${synthesis.section2}`;
  const { report: fullReport, includedIds } = await resolveReportRefs(rawReport, runDate);

  // `included_in_report` is the ground truth for source trust: which items actually reached
  // the user, not which ones merely scored well. Reset first so a re-run of this phase is
  // idempotent rather than cumulative.
  await db.update(extractions).set({ includedInReport: false }).where(eq(extractions.runDate, runDate));
  if (includedIds.length > 0) {
    await db.update(extractions).set({ includedInReport: true }).where(inArray(extractions.id, includedIds));
  }

  // The caller only knows how many items were handed to synthesis. Now that the refs are
  // resolved, the real figure is available; fall back to the caller's estimate if the model
  // emitted no usable anchors at all.
  const refsUsable = includedIds.length > 0;
  const reportItemsIncluded = refsUsable ? includedIds.length : itemsIncluded;

  // Write daily report
  await db.insert(dailyReports).values({
    reportDate: runDate,
    fullReport,
    shortSummary: synthesis.section1.split("\n").slice(0, 5).join(" ").slice(0, 500),
    itemCount,
    itemsIncluded: reportItemsIncluded,
    itemsFiltered: itemCount - reportItemsIncluded,
    tokensIn: synthesis.tokensIn,
    tokensOut: synthesis.tokensOut,
    aiCalls: 2,
    questionGateFired,
    webSearchesRun,
  }).onConflictDoUpdate({
    target: dailyReports.reportDate,
    set: { fullReport, shortSummary: synthesis.section1.slice(0, 500), tokensIn: synthesis.tokensIn, tokensOut: synthesis.tokensOut },
  });

  // Parse and apply Section 1 SYSTEM block
  const s1System = parseSystemBlock(synthesis.section1);
  if (s1System) {
    for (const topic of s1System.new_topics ?? []) {
      await db.insert(activeTopics).values({
        headline: topic.headline,
        domain: topic.domain,
        runningSummary: topic.summary,
        firstSeen: runDate,
        lastUpdated: runDate,
        status: "active",
        updateCount: 1,
      }).onConflictDoNothing();
    }

    for (const update of s1System.updated_topics ?? []) {
      await db.update(activeTopics)
        .set({ runningSummary: update.new_summary, status: update.status, lastUpdated: runDate })
        .where(eq(activeTopics.id, update.id));
    }

    for (const entity of s1System.new_entities ?? []) {
      await db.insert(entities).values({
        name: entity.name,
        type: entity.type,
        domain: entity.domain,
        firstSeen: runDate,
        lastMentioned: runDate,
        mentionCount: 1,
        status: "active",
      }).onConflictDoNothing();
    }

    await processSkillSuggestions(s1System.skill_suggestions ?? [], runDate, "report_section");
  }

  // Parse and apply Section 2 SYSTEM block
  const s2System = parseSystemBlock(synthesis.section2);
  if (s2System) {
    for (const contact of s2System.new_contacts ?? []) {
      await db.insert(contacts).values({
        identifier: contact.identifier,
        name: contact.name,
        relationship: contact.relationship,
        priority: contact.priority ?? "normal",
      }).onConflictDoNothing();
    }

    for (const note of s2System.notes_to_write ?? []) {
      await db.insert(notes).values({
        content: note.content,
        scope: note.scope ?? "global",
        createdBy: "system",
      });
    }
  }

  await writeSourceDailyScores(runDate, refsUsable);
  await upsertEntitiesFromExtractions(runDate);
  await markDormantEntities(runDate);

  console.log("[Phase 6] Done");
  return fullReport;
}

async function writeSourceDailyScores(runDate: string, refsUsable: boolean): Promise<void> {
  // Join extractions → raw_items for today, only newsletters with a sourceName
  const rows = await db
    .select({
      sourceName: rawItems.sourceName,
      relevanceScore: extractions.relevanceScore,
      effectiveRelevance: extractions.effectiveRelevance,
      includedInReport: extractions.includedInReport,
    })
    .from(extractions)
    .innerJoin(rawItems, eq(rawItems.id, extractions.rawItemId))
    .where(and(eq(extractions.runDate, runDate), eq(rawItems.sourceType, "newsletter")));

  if (!refsUsable) {
    // No usable anchors this run. Scoring every source at a 0% include rate would punish them
    // for a synthesis formatting failure, so fall back to the old relevance proxy for a day.
    console.warn("[Phase 6] No resolvable report refs - include rate falls back to relevance >= 3");
  }

  // Group by sourceName
  const bySource = new Map<string, { relevances: number[]; effectives: number[]; included: number }>();
  for (const row of rows) {
    if (!row.sourceName) continue;
    const entry = bySource.get(row.sourceName) ?? { relevances: [], effectives: [], included: 0 };
    if (row.relevanceScore != null) entry.relevances.push(row.relevanceScore);
    if (row.effectiveRelevance != null) entry.effectives.push(row.effectiveRelevance);
    const included = refsUsable ? row.includedInReport === true : (row.effectiveRelevance ?? 0) >= 3;
    if (included) entry.included += 1;
    bySource.set(row.sourceName, entry);
  }

  for (const [sourceName, { relevances, effectives, included }] of bySource) {
    const itemsReceived = relevances.length;
    if (itemsReceived === 0) continue;

    const avgRelevance = avg(relevances);
    const avgEffectiveRelevance = effectives.length ? avg(effectives) : avgRelevance;
    const itemsIncluded = included;
    const includeRate = itemsIncluded / itemsReceived;
    // composite 0–10: quality-weighted (7pts) + breadth signal (3pts)
    const compositeScore = Math.min(10, (avgEffectiveRelevance / 5) * 7 + includeRate * 3);

    await db
      .insert(sourceDailyScores)
      .values({ sourceName, runDate, itemsReceived, itemsIncluded, avgRelevance, avgEffectiveRelevance, includeRate, compositeScore })
      .onConflictDoUpdate({
        target: [sourceDailyScores.sourceName, sourceDailyScores.runDate],
        set: { itemsReceived, itemsIncluded, avgRelevance, avgEffectiveRelevance, includeRate, compositeScore },
      });

    // Recompute rolling 30-day composite for this source
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000).toISOString().split("T")[0];
    const window = await db
      .select({ compositeScore: sourceDailyScores.compositeScore, itemsReceived: sourceDailyScores.itemsReceived })
      .from(sourceDailyScores)
      .where(and(eq(sourceDailyScores.sourceName, sourceName), gte(sourceDailyScores.runDate, thirtyDaysAgo)));

    const totalWeight = window.reduce((s, r) => s + (r.itemsReceived ?? 1), 0);
    const weightedSum = window.reduce((s, r) => s + (r.compositeScore ?? 0) * (r.itemsReceived ?? 1), 0);
    const compositeScore30d = totalWeight > 0 ? weightedSum / totalWeight : null;

    await db
      .insert(sourceQuality)
      .values({ sourceName, compositeScore30d })
      .onConflictDoUpdate({ target: sourceQuality.sourceName, set: { compositeScore30d, updatedAt: drizzleSql`now()` } });
  }
}

async function upsertEntitiesFromExtractions(runDate: string): Promise<void> {
  const rows = await db
    .select({ extractedJson: extractions.extractedJson })
    .from(extractions)
    .innerJoin(rawItems, eq(rawItems.id, extractions.rawItemId))
    .where(and(eq(extractions.runDate, runDate), eq(rawItems.sourceType, "newsletter")));

  // Aggregate entities across all newsletter extractions for today
  const entityMap = new Map<string, { name: string; aliases: Set<string>; type: string; domain: string; count: number }>();
  const relationList: { from: string; to: string; type: string; confidence: number }[] = [];

  for (const row of rows) {
    const json = row.extractedJson as any;
    const graph = json?.entities_graph;
    if (!graph) continue;

    for (const e of (graph.entities ?? []) as { name: string; aliases: string[]; type: string; domain: string }[]) {
      const key = e.name.toLowerCase();
      const hit = entityMap.get(key);
      if (hit) {
        hit.count++;
        for (const alias of e.aliases ?? []) hit.aliases.add(alias);
      } else {
        entityMap.set(key, { name: e.name, aliases: new Set(e.aliases ?? []), type: e.type ?? "concept", domain: e.domain ?? "", count: 1 });
      }
    }

    for (const r of (graph.relations ?? []) as { from: string; to: string; type: string; confidence: number }[]) {
      relationList.push(r);
    }
  }

  if (entityMap.size === 0) return;

  // Load existing entities to match by lowercase name
  const existingEntities = await db.select({ id: entities.id, name: entities.name, mentionCount: entities.mentionCount, aliases: entities.aliases }).from(entities);
  const existingByName = new Map(existingEntities.map((e) => [e.name.toLowerCase(), e]));

  // Upsert entities
  const nameToId = new Map<string, string>();
  for (const [key, data] of entityMap) {
    const aliases = [...data.aliases].filter((a) => a.toLowerCase() !== key);
    const existing = existingByName.get(key);

    if (existing) {
      const mergedAliases = [...new Set([...(existing.aliases ?? []), ...aliases])];
      await db.update(entities)
        .set({ mentionCount: (existing.mentionCount ?? 0) + data.count, lastMentioned: runDate, aliases: mergedAliases })
        .where(eq(entities.id, existing.id));
      nameToId.set(key, existing.id);
    } else {
      const [inserted] = await db.insert(entities)
        .values({ name: data.name, aliases: aliases.length > 0 ? aliases : null, type: data.type, domain: data.domain, firstSeen: runDate, lastMentioned: runDate, mentionCount: data.count, status: "active" })
        .returning({ id: entities.id });
      if (inserted) nameToId.set(key, inserted.id);
    }
  }

  // Upsert relations using resolved entity IDs
  for (const rel of relationList) {
    const fromId = nameToId.get(rel.from.toLowerCase());
    const toId = nameToId.get(rel.to.toLowerCase());
    if (!fromId || !toId || fromId === toId) continue;

    await db.insert(entityRelations)
      .values({ fromId, toId, relationType: rel.type, confidence: rel.confidence, firstSeen: runDate, lastSeen: runDate })
      .onConflictDoNothing();
  }

  console.log(`[Phase 6] Upserted ${entityMap.size} entities, ${relationList.length} relation(s) from Ollama output`);
}

async function markDormantEntities(runDate: string): Promise<void> {
  const threshold = new Date(Date.now() - 14 * 86400_000).toISOString().split("T")[0];

  const result = await db
    .update(entities)
    .set({ status: "dormant" })
    // NULL-tolerant on purpose: `last_mentioned < date` is never TRUE for a NULL, so a row
    // inserted without one used to be permanently unreachable by every cleanup path.
    .where(and(eq(entities.status, "active"), drizzleSql`(last_mentioned IS NULL OR last_mentioned < ${threshold})`))
    .returning({ id: entities.id });

  // Reactivate any dormant entity mentioned in today's run
  await db
    .update(entities)
    .set({ status: "active" })
    .where(and(eq(entities.status, "dormant"), eq(entities.lastMentioned, runDate)));

  if (result.length > 0) {
    console.log(`[Phase 6] Marked ${result.length} entity(ies) as dormant (absent > 14 days)`);
  }
}

async function processSkillSuggestions(
  suggestions: { skill: string; reason: string; parameters: Record<string, unknown> }[],
  runDate: string,
  triggeredBy: string,
): Promise<void> {
  for (const suggestion of suggestions) {
    const skill = getSkill(suggestion.skill);
    if (!skill) {
      console.warn(`[Phase 6] Unknown skill suggestion: ${suggestion.skill} - skipped`);
      continue;
    }

    if (skill.risk_level === "low") {
      const [row] = await db.insert(skillExecutions).values({
        runDate,
        skillName: skill.name,
        parameters: suggestion.parameters,
        status: "pending",
        triggeredBy,
      }).returning({ id: skillExecutions.id });

      try {
        const result = await skill.execute(suggestion.parameters);
        await db.update(skillExecutions).set({ status: "executed", result }).where(eq(skillExecutions.id, row.id));
        console.log(`[Phase 6] Skill executed: ${skill.name} - ${result.slice(0, 80)}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await db.update(skillExecutions).set({ status: "failed", result: msg }).where(eq(skillExecutions.id, row.id));
        console.error(`[Phase 6] Skill failed: ${skill.name} - ${msg}`);
      }
    } else {
      // Medium/high/critical: log as pending for manual review
      await db.insert(skillExecutions).values({
        runDate,
        skillName: skill.name,
        parameters: suggestion.parameters,
        status: "pending",
        triggeredBy,
      });
      console.log(`[Phase 6] Skill suggestion logged (${skill.risk_level}, manual review): ${skill.name}`);
    }
  }
}

import { db, extractions, activeTopics, sourceQuality, contacts, notes, entities, rawItems } from "../db";
import { eq, and } from "drizzle-orm";
import type { CalendarEvent, TodoItem } from "../ingest/google";
import { isPersonalItemIncluded } from "./email-category";
import { runAllSlots, type WebSearchResult } from "../search/slots";
import { loadLongTermContext, type LongTermContext } from "./long-term-context";

export interface ContextPayload {
  volumeSignal: "light" | "normal" | "heavy";
  highRelevanceCount: number;
  activeTopics: (typeof activeTopics.$inferSelect)[];
  newsletterItems: ExtractionWithSource[];
  personalItems: ExtractionWithSource[];
  entityContexts: (typeof entities.$inferSelect)[];
  notesIntel: (typeof notes.$inferSelect)[];
  notesPersonal: (typeof notes.$inferSelect)[];
  knownContacts: (typeof contacts.$inferSelect)[];
  sourceQualities: Map<string, number>;
  calendarItems: CalendarEvent[];
  todoItems: TodoItem[];
  webSearchResults: WebSearchResult[];
  /** Context Builder output: standing rules plus the pre-split long-term context document. */
  longTermContext: LongTermContext;
}

/**
 * Section 2 receives the open task list as prompt input, uncapped until now. A real backlog is
 * hundreds of lines, which both costs input tokens every single day and buries the day's actual
 * signal in a section budgeted at 300-500 words.
 *
 * Rank by how much the task bears on today, then cap. Undated tasks are kept ahead of
 * far-future ones rather than dropped, because Section 2 uses the list to notice that an
 * email's action is "already in to-do", and most backlog items carry no due date at all.
 */
function prioritiseTodos(items: TodoItem[], runDate: string): TodoItem[] {
  const horizonDays = parseInt(process.env.TODO_HORIZON_DAYS ?? "14");
  const maxItems = parseInt(process.env.TODO_MAX_ITEMS ?? "40");

  const horizon = new Date(`${runDate}T00:00:00Z`);
  horizon.setUTCDate(horizon.getUTCDate() + horizonDays);
  const horizonStr = horizon.toISOString().split("T")[0];

  const rank = (t: TodoItem): number => {
    if (!t.due) return 2;                    // undated backlog: keep, but after anything dated soon
    if (t.due < runDate) return 0;           // overdue
    return t.due <= horizonStr ? 1 : 3;      // inside the horizon, else far future
  };

  const ordered = [...items].sort(
    (a, b) => rank(a) - rank(b) || (a.due ?? "9999-99-99").localeCompare(b.due ?? "9999-99-99"),
  );

  if (ordered.length > maxItems) {
    console.log(
      `[Phase 3] ${ordered.length} open todos, sending the ${maxItems} most relevant ` +
      `(overdue and due within ${horizonDays}d first)`,
    );
  }

  return ordered.slice(0, maxItems);
}

export interface ExtractionWithSource {
  extraction: typeof extractions.$inferSelect;
  sourceName: string | null;
  sourceType: string;
}

function parseJsonRows<T>(rows: { rawContent: string | null }[]): T[] {
  return rows.flatMap((r) => { try { return [JSON.parse(r.rawContent ?? "") as T]; } catch { return []; } });
}

function corroborationBonus(sourceCount: number): number {
  if (sourceCount >= 4) return 1.0;
  if (sourceCount === 3) return 0.7;
  if (sourceCount === 2) return 0.3;
  return 0;
}

export async function runPhase3(runDate: string): Promise<ContextPayload> {
  console.log(`[Phase 3] Assembling context for ${runDate}`);

  // Fetch topics first (needed for Slot 1 query generation)
  const topicsResult = await db.select().from(activeTopics).where(eq(activeTopics.status, "active"));

  const [
    todaysExtractions,
    qualityResult,
    allNotes,
    allContacts,
    entityList,
    calendarRaw,
    todoRaw,
    webSearchResults,
  ] = await Promise.all([
    db.query.extractions.findMany({
      where: eq(extractions.runDate, runDate),
      with: { rawItem: true },
    }),
    db.select().from(sourceQuality),
    db.select().from(notes),
    db.select().from(contacts),
    db.select().from(entities).where(eq(entities.status, "active")),
    db.select({ rawContent: rawItems.rawContent })
      .from(rawItems)
      .where(and(eq(rawItems.runDate, runDate), eq(rawItems.sourceType, "calendar"))),
    db.select({ rawContent: rawItems.rawContent })
      .from(rawItems)
      .where(and(eq(rawItems.runDate, runDate), eq(rawItems.sourceType, "todo"))),
    runAllSlots(topicsResult, runDate).catch((err) => {
      console.warn("[Phase 3] Web search failed, continuing without:", err);
      return [] as WebSearchResult[];
    }),
  ]);

  const calendarItems = parseJsonRows<CalendarEvent>(calendarRaw);
  const todoItems = prioritiseTodos(parseJsonRows<TodoItem>(todoRaw), runDate);

  const qualityMap = new Map(qualityResult.map((s) => [s.sourceName, s.trustScore ?? 1.0]));

  // Group newsletter items by entity overlap to compute corroboration
  const entityToItems = new Map<string, string[]>();
  for (const row of todaysExtractions) {
    const json = row.extractedJson as any;
    if (!json || !json.entities) continue;
    for (const entity of json.entities as string[]) {
      const key = entity.toLowerCase();
      if (!entityToItems.has(key)) entityToItems.set(key, []);
      entityToItems.get(key)!.push(row.id);
    }
  }

  // Compute effective relevance with trust score + corroboration
  const items: ExtractionWithSource[] = [];
  for (const row of todaysExtractions) {
    const rawItem = (row as any).rawItem;
    const trustScore = qualityMap.get(rawItem?.sourceName ?? "") ?? 1.0;
    const json = row.extractedJson as any;
    const entityNames: string[] = json?.entities ?? [];

    const relatedItemIds = new Set(entityNames.flatMap((e) => entityToItems.get(e.toLowerCase()) ?? []));
    const sourceCount = relatedItemIds.size > 0 ? new Set(
      [...relatedItemIds].map((id) => todaysExtractions.find((r) => r.id === id)?.rawItemId)
    ).size : 1;

    const effective = ((row.relevanceScore ?? 0) * trustScore) + corroborationBonus(sourceCount);

    items.push({
      extraction: { ...row, effectiveRelevance: effective },
      sourceName: rawItem?.sourceName ?? null,
      sourceType: rawItem?.sourceType ?? "unknown",
    });
  }

  const newsletterItems = items.filter((i) => i.sourceType === "newsletter" && (i.extraction.effectiveRelevance ?? 0) >= 3);
  const personalItems = items.filter((i) => {
    if (i.sourceType !== "personal_email" && i.sourceType !== "sms") return false;
    return isPersonalItemIncluded(i.extraction.extractedJson as Record<string, any> | null, i.extraction.effectiveRelevance ?? 0);
  });

  const highRelevanceCount = newsletterItems.filter((i) => (i.extraction.effectiveRelevance ?? 0) >= 3).length;
  const volumeSignal: "light" | "normal" | "heavy" =
    highRelevanceCount < 10 ? "light" : highRelevanceCount > 25 ? "heavy" : "normal";

  // Relevant entity contexts (mention_count >= 3)
  const mentionedEntityNames = new Set(
    items.flatMap((i) => ((i.extraction.extractedJson as any)?.entities ?? []) as string[])
      .map((e: string) => e.toLowerCase())
  );
  const entityContexts = entityList.filter(
    (e) => (e.mentionCount ?? 0) >= 3 && mentionedEntityNames.has(e.name.toLowerCase())
  );

  const longTermContext = await loadLongTermContext();
  if (longTermContext.problem) {
    // Not fatal: the briefing is simply less personalised without it.
    console.warn(`[Phase 3] long-term context unavailable - ${longTermContext.problem}`);
  }

  console.log(
    `[Phase 3] ${newsletterItems.length} newsletter items, ${personalItems.length} personal items, ` +
    `${calendarItems.length} calendar events, ${todoItems.length} todos, volume: ${volumeSignal}, ` +
    `${webSearchResults.length} web search slot(s), ` +
    `${longTermContext.standingRules.length} standing rule(s), ` +
    `context doc ${longTermContext.personalSections.length + longTermContext.intelSections.length} chars`
  );

  return {
    volumeSignal,
    highRelevanceCount,
    activeTopics: topicsResult,
    newsletterItems,
    personalItems,
    entityContexts,
    notesIntel: allNotes.filter((n) => n.scope === "intel" || n.scope === "global"),
    notesPersonal: allNotes.filter((n) => n.scope === "personal" || n.scope === "global"),
    knownContacts: allContacts,
    sourceQualities: qualityMap,
    calendarItems,
    todoItems,
    webSearchResults,
    longTermContext,
  };
}

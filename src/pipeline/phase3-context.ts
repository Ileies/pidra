import { db, extractions, activeTopics, sourceQuality, contacts, notes, entities, rawItems } from "../db";
import { eq, and, isNull } from "drizzle-orm";
import type { CalendarEvent, TodoItem } from "../ingest/google";
import { decideGate, type GateDecision } from "./gate";
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
  /** Why this item was or was not handed to synthesis. Persisted before this phase returns. */
  gate: GateDecision;
}

function parseJsonRows<T>(rows: { rawContent: string | null }[]): T[] {
  return rows.flatMap((r) => { try { return [JSON.parse(r.rawContent ?? "") as T]; } catch { return []; } });
}

/**
 * Writes the gate's verdict back onto every extraction of the run, so `/[date]/triage` can say
 * why an item is missing from the briefing instead of only that it is.
 *
 * `effective_relevance` is overwritten on purpose: Phase 2 seeds the column with the raw
 * relevance score as a placeholder, and the number the gate actually compared is this one -
 * trust-weighted and corroborated. Phase 6 reads the column afterwards for the source scores,
 * which means its relevance fallback now matches the real bar rather than approximating it.
 *
 * Row by row rather than one statement: the phase is wrapped in `withRetry`, so this has to be
 * idempotent, and it is - every attempt writes the same verdict over the same id.
 */
async function persistGate(items: ExtractionWithSource[]): Promise<void> {
  for (const item of items) {
    await db
      .update(extractions)
      .set({
        effectiveRelevance: item.gate.effectiveRelevance,
        gatePassed: item.gate.passed,
        gateReason: item.gate.reason,
        gateDetail: item.gate.detail,
      })
      .where(eq(extractions.id, item.extraction.id));
  }
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
    // Soft-deleted notes must not keep steering the briefing.
    db.select().from(notes).where(isNull(notes.deletedAt)),
    db.select().from(contacts),
    db.select().from(entities).where(eq(entities.status, "active")),
    db.select({ rawContent: rawItems.rawContent })
      .from(rawItems)
      .where(and(eq(rawItems.runDate, runDate), eq(rawItems.sourceType, "calendar"))),
    // Todos are one row per task, not one per task per day: Phase 1 refreshes `run_date` on
    // every task that is still open. So this reads the current snapshot, and a task that was
    // completed or deleted falls out on its own by not being refreshed.
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

  // Compute effective relevance with trust score + corroboration, and run the gate on it
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

    const sourceType = rawItem?.sourceType ?? "unknown";
    const gate = decideGate({
      sourceType,
      aiFailed: row.aiFailed ?? false,
      extractedJson: (row.extractedJson as Record<string, unknown> | null) ?? null,
      relevanceScore: row.relevanceScore,
      trustScore,
      sourceCount,
    });

    items.push({
      extraction: { ...row, effectiveRelevance: gate.effectiveRelevance },
      sourceName: rawItem?.sourceName ?? null,
      sourceType,
      gate,
    });
  }

  await persistGate(items);

  // The two lists synthesis receives are exactly what the gate passed - one decision, recorded
  // and acted on. They used to be two inline filters, which is how a dropped item became
  // untraceable.
  const newsletterItems = items.filter((i) => i.gate.passed && i.sourceType === "newsletter");
  const personalItems = items.filter(
    (i) => i.gate.passed && (i.sourceType === "personal_email" || i.sourceType === "sms"),
  );

  // Every newsletter item that passed the gate cleared the threshold, so the two are the same
  // figure now.
  const highRelevanceCount = newsletterItems.length;
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
    // `problem` is also set when a fallback candidate succeeded, so the two cases read differently:
    // "unavailable" would be a lie about a run that did load 43k characters from an older harvest.
    // Neither is fatal - the briefing is simply less personalised without it.
    const loaded = longTermContext.intelSections || longTermContext.personalSections;
    console.warn(
      loaded
        ? `[Phase 3] long-term context loaded from an older harvest - ${longTermContext.problem}`
        : `[Phase 3] long-term context unavailable - ${longTermContext.problem}`,
    );
  }

  const gatedOut = items.length - newsletterItems.length - personalItems.length;
  console.log(
    `[Phase 3] ${newsletterItems.length} newsletter items, ${personalItems.length} personal items ` +
    `(${gatedOut} of ${items.length} dropped at the gate - see /${runDate}/triage), ` +
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

import { db, extractions, activeTopics, sourceQuality, contacts, notes, entities, rawItems } from "../db";
import { eq, and, isNull, inArray } from "drizzle-orm";
import type { CalendarEvent, TodoItem } from "../ingest/google";
import { decideGate, type GateDecision } from "./gate";
import { runAllSlots, type WebSearchResult } from "../search/slots";
import { loadLongTermContext, type LongTermContext } from "./long-term-context";
import { NEWS_SOURCE_TYPE } from "../news/config";
import { EMPTY_NEWS_DESK, type NewsDeskOutcome } from "../news/run";
import { handoffForOrder, orderNewsletterItems, SECTION1_CAPACITY } from "./section1-handoff";
import { revivableTopics } from "./topic-lifecycle";
import { normalizeEntityKey } from "../util/entities";
import { span } from "../util/trace";

/** How many entities Section 1 gets context for. The gate and SECTION1_CAPACITY already bound
 *  how many claims reach synthesis; this bounds the entity side of the same payload the same way. */
const ENTITY_CONTEXT_CAP = 15;

export interface ContextPayload {
  volumeSignal: "light" | "normal" | "heavy";
  highRelevanceCount: number;
  activeTopics: (typeof activeTopics.$inferSelect)[];
  revivableTopics: (typeof activeTopics.$inferSelect)[];
  /** All gate-passed newsletter claims, ordered for Section 1; only the first 30 are sent. */
  newsletterItems: ExtractionWithSource[];
  personalItems: ExtractionWithSource[];
  /** News desk stories that passed the gate, for the News section. */
  newsItems: ExtractionWithSource[];
  /** How the news desks did on this run: the window, the home, which desks failed. */
  newsDesk: NewsDeskOutcome;
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
  const horizonDays = parseInt(process.env.OPEN_TASKS_HORIZON_DAYS ?? "14");
  const maxItems = parseInt(process.env.OPEN_TASKS_MAX_ITEMS ?? "40");

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
async function persistGate(items: ExtractionWithSource[], newsletterOrder: Map<string, number>): Promise<void> {
  for (const item of items) {
    const order = newsletterOrder.get(item.extraction.id) ?? null;
    await db
      .update(extractions)
      .set({
        effectiveRelevance: item.gate.effectiveRelevance,
        gatePassed: item.gate.passed,
        gateReason: item.gate.reason,
        gateDetail: item.gate.detail,
        synthesisOrder: order,
        synthesisHandoff: handoffForOrder(order),
      })
      .where(eq(extractions.id, item.extraction.id));
  }
}

export async function runPhase3(runDate: string, newsDesk: NewsDeskOutcome = EMPTY_NEWS_DESK): Promise<ContextPayload> {
  console.log(`[Phase 3] Assembling context for ${runDate}`);

  // Fetch topics first (needed for Slot 1 query generation)
  const topicsResult = await db.select().from(activeTopics).where(eq(activeTopics.status, "active"));

  const [
    todaysExtractions,
    qualityResult,
    allNotes,
    allContacts,
    entityList,
    inactiveTopics,
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
    db.select().from(contacts).where(isNull(contacts.removedAt)),
    db.select().from(entities).where(eq(entities.status, "active")),
    db.select().from(activeTopics).where(inArray(activeTopics.status, ["dormant", "archived"])),
    db.select({ rawContent: rawItems.rawContent })
      .from(rawItems)
      .where(and(eq(rawItems.runDate, runDate), eq(rawItems.sourceType, "calendar"))),
    // Todos are one row per task, not one per task per day: Phase 1 refreshes `run_date` on
    // every task that is still open. So this reads the current snapshot, and a task that was
    // completed or deleted falls out on its own by not being refreshed.
    db.select({ rawContent: rawItems.rawContent })
      .from(rawItems)
      .where(and(eq(rawItems.runDate, runDate), eq(rawItems.sourceType, "todo"))),
    span("phase3-websearch", () => runAllSlots(topicsResult, runDate)).catch((err) => {
      console.warn("[Phase 3] Web search failed, continuing without:", err);
      return [] as WebSearchResult[];
    }),
  ]);

  const calendarItems = parseJsonRows<CalendarEvent>(calendarRaw);
  const todoItems = prioritiseTodos(parseJsonRows<TodoItem>(todoRaw), runDate);

  const qualityMap = new Map(qualityResult.map((s) => [s.sourceName, s.trustScore ?? 1.0]));

  // A news desk story is not a newsletter's corroboration. The desks return dozens of stories
  // naming the same few countries and leaders, so counting them would lift the bonus on almost
  // every newsletter item that mentions one - a change to the newsletter bar nobody decided.
  const isNews = (row: (typeof todaysExtractions)[number]) => (row as any).rawItem?.sourceType === NEWS_SOURCE_TYPE;

  // Group newsletter items by entity overlap to compute corroboration
  const entityToItems = new Map<string, string[]>();
  for (const row of todaysExtractions) {
    if (isNews(row)) continue;
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
    const news = sourceType === NEWS_SOURCE_TYPE;
    const gate = decideGate({
      sourceType,
      aiFailed: row.aiFailed ?? false,
      extractedJson: (row.extractedJson as Record<string, unknown> | null) ?? null,
      relevanceScore: row.relevanceScore,
      // A desk's significance is compared as it stands: a desk has no trust score, and its
      // stories are neither corroborated nor corroborating (see above).
      trustScore: news ? 1 : trustScore,
      sourceCount: news ? 1 : sourceCount,
    });

    items.push({
      extraction: { ...row, effectiveRelevance: gate.effectiveRelevance },
      sourceName: rawItem?.sourceName ?? null,
      sourceType,
      gate,
    });
  }

  // Section 1 has a separate capacity after the gate. Keep the full list for counts and
  // scoring, but persist its order and every item that cannot fit in the synthesis payload.
  const newsletterItems = orderNewsletterItems(
    items.filter((i) => i.gate.passed && i.sourceType === "newsletter"),
  );
  const newsletterOrder = new Map(newsletterItems.map((item, index) => [item.extraction.id, index + 1]));
  await persistGate(items, newsletterOrder);

  // The remaining sections receive every item the gate passed.
  const personalItems = items.filter(
    (i) => i.gate.passed && (i.sourceType === "personal_email" || i.sourceType === "sms"),
  );
  const newsItems = items.filter((i) => i.gate.passed && i.sourceType === NEWS_SOURCE_TYPE);

  // Every newsletter item that passed the gate cleared the threshold, so the two are the same
  // figure now.
  const highRelevanceCount = newsletterItems.length;
  const volumeSignal: "light" | "normal" | "heavy" =
    highRelevanceCount < 10 ? "light" : highRelevanceCount > 25 ? "heavy" : "normal";

  // Relevant entity contexts (mention_count >= 3), for Section 1. Matched only against the
  // claims Section 1 actually receives - gate-passed newsletter items within SECTION1_CAPACITY -
  // so a claim the gate rejected cannot introduce entity context on its own; the News section is
  // written from its stories alone, so news entities are excluded the same way they always were.
  // Matching is canonical-name-or-alias, case-insensitive, and the result is capped and ranked by
  // mention count like everything else Section 1 receives a bounded slice of.
  const section1NewsletterItems = newsletterItems.slice(0, SECTION1_CAPACITY);
  const mentionedKeys = new Set(
    section1NewsletterItems
      .flatMap((i) => ((i.extraction.extractedJson as any)?.entities ?? []) as string[])
      .map(normalizeEntityKey)
  );
  const entityByKey = new Map<string, (typeof entityList)[number]>();
  for (const e of entityList) {
    entityByKey.set(normalizeEntityKey(e.name), e);
    for (const alias of e.aliases ?? []) {
      const aliasKey = normalizeEntityKey(alias);
      if (!entityByKey.has(aliasKey)) entityByKey.set(aliasKey, e);
    }
  }
  const matchedEntities = new Map<string, (typeof entityList)[number]>();
  for (const key of mentionedKeys) {
    const e = entityByKey.get(key);
    if (e && (e.mentionCount ?? 0) >= 3) matchedEntities.set(e.id, e);
  }
  const entityContexts = [...matchedEntities.values()]
    .sort((a, b) => (b.mentionCount ?? 0) - (a.mentionCount ?? 0))
    .slice(0, ENTITY_CONTEXT_CAP);

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

  const gatedOut = items.length - newsletterItems.length - personalItems.length - newsItems.length;
  console.log(
    `[Phase 3] ${newsletterItems.length} newsletter items, ${personalItems.length} personal items, ` +
    `${newsItems.length} news stories ` +
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
    revivableTopics: revivableTopics(inactiveTopics, newsletterItems.slice(0, SECTION1_CAPACITY).map((item) => item.extraction.extractedJson as { headline?: string; key_claim?: string; entities?: string[] })),
    newsletterItems,
    personalItems,
    newsItems,
    newsDesk,
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

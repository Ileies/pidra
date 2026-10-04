import { parseJsonRows } from "../util/json";
import { db, extractions, activeTopics, sourceQuality, contacts, notes, entities, rawItems } from "../db";
import { eq, and, or, gte, isNull, inArray } from "drizzle-orm";
import type { CalendarEvent, TodoItem } from "../ingest/google";
import { runAllSlots, type WebSearchResult } from "../search/slots";
import { loadLongTermContext, type LongTermContext } from "./long-term-context";
import { NEWS_SOURCE_TYPE } from "../news/config";
import { EMPTY_NEWS_DESK, type NewsDeskOutcome } from "../news/run";
import { orderNewsletterItems, SECTION1_CAPACITY } from "./section1-handoff";
import { revivableTopics } from "./topic-lifecycle";
import { span } from "../util/trace";
import { matchEntityContexts } from "./entity-context";
import { gateExtractions, persistGate, type ExtractionWithSource } from "./gate-items";
import { prioritiseTodos } from "./todos";

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
    db
      .select({ extraction: extractions, sourceName: rawItems.sourceName, sourceType: rawItems.sourceType })
      .from(extractions)
      .leftJoin(rawItems, eq(rawItems.id, extractions.rawItemId))
      .where(eq(extractions.runDate, runDate)),
    db.select().from(sourceQuality),
    // Soft-deleted and expired notes must not keep steering the briefing; a note is live through its expiry day.
    db.select().from(notes).where(and(isNull(notes.deletedAt), or(isNull(notes.expiresAt), gte(notes.expiresAt, runDate)))),
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

  const items = gateExtractions(todaysExtractions, qualityMap);

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
    `context doc ${longTermContext.personalSections.length + longTermContext.intelSections.length} chars`
  );

  return {
    volumeSignal,
    highRelevanceCount,
    activeTopics: topicsResult,
    revivableTopics: revivableTopics(inactiveTopics, newsletterItems.slice(0, SECTION1_CAPACITY).map((item) => item.extraction.extractedJson ?? {})),
    newsletterItems,
    personalItems,
    newsItems,
    newsDesk,
    entityContexts: matchEntityContexts(newsletterItems, entityList),
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

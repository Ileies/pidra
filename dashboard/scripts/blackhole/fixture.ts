/**
 * The offline snapshot the blackhole suite serves in place of `/api/offline/snapshot`, so the suite
 * needs no database and cannot read or write a real one. Every value is a placeholder: nothing here
 * may ever be copied from the live mirror.
 *
 * Typed against the mirror's own row types, so a change to what the pages read breaks
 * `svelte-check` here instead of turning into a suite that passes against a shape no page reads.
 */

import type {
  MirroredAppearance,
  MirroredContact,
  MirroredContextDoc,
  MirroredEntity,
  MirroredExtraction,
  MirroredReport,
  MirroredTopic,
} from "../../src/lib/offline/repo.ts";
import type { NoteRow } from "../../src/lib/notes/api.ts";

/** The UTC date, as the pages compute "today": a briefing is dated by its UTC day. */
export const TODAY = new Date().toISOString().slice(0, 10);
export const YESTERDAY = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
/** A day the mirror has no report for, for the "no report" state and its Run pipeline form. */
export const EMPTY_DAY = "2020-01-01";

export const EXTRACTION = {
  personal: "00000000-0000-4000-8000-000000000001",
  news: "00000000-0000-4000-8000-000000000002",
  intel: "00000000-0000-4000-8000-000000000003",
} as const;

export const NOTE_ID = "00000000-0000-4000-8000-0000000000a1";
export const TRASHED_NOTE_ID = "00000000-0000-4000-8000-0000000000a2";
export const ENTITY_ID = "00000000-0000-4000-8000-0000000000c1";
const OTHER_ENTITY_ID = "00000000-0000-4000-8000-0000000000c2";
export const CONTACT_ID = "00000000-0000-4000-8000-0000000000d1";
export const TOPIC_ID = "00000000-0000-4000-8000-0000000000e1";

/** Text each mirrored page must render, so "a designed state" means "the mirror's data", not
 *  "some page". */
export const TEXT = {
  personal: "Renew the example permit before Friday.",
  news: "An example council approved an example budget.",
  intel: "An example library shipped an example release.",
  yesterday: "Yesterday's example briefing entry.",
  note: "Example note: bring the placeholder folder.",
  trashedNote: "Example note that was deleted.",
  harvest: "Example harvested interests section.",
  entity: "Example Organisation",
  otherEntity: "Example Project",
  contact: "sender@example.com",
  topic: "Example standing story",
  correction: "Example correction statement.",
} as const;

const NOW = new Date().toISOString();

function report(date: string, structured: MirroredReport["structured"]): MirroredReport {
  return {
    id: date,
    date,
    report: {
      shortSummary: `Example summary for ${date}.`,
      itemCount: 12,
      itemsIncluded: 3,
      itemsFiltered: 9,
      tokensIn: 1000,
      tokensOut: 200,
      aiCalls: 4,
      webSearchesRun: 0,
      createdAt: `${date}T05:00:00.000Z`,
    },
    pipelineRun: {
      status: "completed",
      failedStep: null,
      stepErrors: [],
      startedAt: `${date}T04:30:00.000Z`,
      completedAt: `${date}T05:00:00.000Z`,
      durationMs: 1_800_000,
    },
    ingestFailures: [],
    structured,
    reportHtml: null,
    ratings: {},
  };
}

/** The quick action on today's personal entry: online-only, so offline it must say so. */
export const ACTION = {
  id: "00000000-0000-4000-8000-0000000000f1",
  title: "Renew the example permit",
} as const;

const reports: MirroredReport[] = [
  {
    ...report(TODAY, {
      personal: [{ urgency: "high", entries: [{ html: `<p>${TEXT.personal}</p>`, refIds: [EXTRACTION.personal] }] }],
      news: [{ group: "World", entries: [{ html: `<p>${TEXT.news}</p>`, refIds: [EXTRACTION.news] }] }],
      intel: [{ domain: "Technology", entries: [{ html: `<p>${TEXT.intel}</p>`, refIds: [EXTRACTION.intel] }] }],
      alsoNoted: [],
    }),
    actions: [
      {
        id: ACTION.id,
        status: "proposed",
        preview: { kind: "add_todo", title: ACTION.title, due: TODAY, notes: null },
        reason: "The example office asks for the renewal before Friday.",
        sourceIds: [EXTRACTION.personal],
      },
    ],
  },
  report(YESTERDAY, {
    personal: [],
    news: [],
    intel: [{ domain: "Technology", entries: [{ html: `<p>${TEXT.yesterday}</p>`, refIds: [] }] }],
    alsoNoted: [],
  }),
];

function extraction(id: string, headline: string, sourceType = "newsletter"): MirroredExtraction {
  return {
    id,
    sourceName: "example-source",
    sourceType,
    receivedAt: `${TODAY}T04:00:00.000Z`,
    rawContent: null,
    sender: "sender@example.com",
    receiver: "user@example.com",
    novelty: "new",
    relevanceScore: 7,
    effectiveRelevance: 7,
    rating: null,
    extracted: { headline, key_claim: `${headline} (key claim)`, topic_tags: ["example"] },
  };
}

const extractions: MirroredExtraction[] = [
  extraction(EXTRACTION.personal, "Example permit reminder"),
  extraction(EXTRACTION.news, "Example council budget"),
  extraction(EXTRACTION.intel, "Example library release"),
];

const notes: NoteRow[] = [
  {
    id: NOTE_ID,
    content: TEXT.note,
    scope: "global",
    created_at: `${YESTERDAY}T08:00:00.000Z`,
    updated_at: `${YESTERDAY}T09:00:00.000Z`,
    expires_at: null,
    created_by: "user",
    updated_by: "user",
    deleted_at: null,
    // One revision, so the history panel (online-only) has something to try to load.
    revision_count: 1,
  },
  {
    id: TRASHED_NOTE_ID,
    content: TEXT.trashedNote,
    scope: "personal",
    created_at: `${YESTERDAY}T07:00:00.000Z`,
    updated_at: `${YESTERDAY}T07:30:00.000Z`,
    expires_at: null,
    created_by: "user",
    updated_by: "user",
    deleted_at: `${YESTERDAY}T07:30:00.000Z`,
    revision_count: 0,
  },
];

const contextDoc: MirroredContextDoc = {
  id: "current",
  run: {
    id: "00000000-0000-4000-8000-0000000000f1",
    mode: "update",
    started_at: `${YESTERDAY}T03:00:00.000Z`,
    completed_at: `${YESTERDAY}T03:30:00.000Z`,
    items_indexed: 10,
    output_path: "context-builder/output/example.md",
    document: null,
  },
  doc: {
    generatedAt: `${YESTERDAY}T03:30:00.000Z`,
    date: YESTERDAY,
    path: "context-builder/output/example.md",
    fullContextHtml: `<h1>3. Interests</h1><p>${TEXT.harvest}</p>`,
    chars: 60,
    sections: [{ key: "3", title: "3. Interests", html: `<p>${TEXT.harvest}</p>`, chars: 40 }],
  },
  docError: null,
  skipped: [],
  corrections: [
    {
      id: "00000000-0000-4000-8000-0000000000f2",
      target_kind: "document",
      target_key: "3",
      operation: "amend",
      statement: TEXT.correction,
      supersedes_text: null,
      rationale: null,
      source: "user",
      created_at: NOW,
    },
  ],
  counts: { contacts: 1, entities: 2, indexed_email: 10, indexed_keep: 2 },
};

const entities: MirroredEntity[] = [
  {
    id: ENTITY_ID,
    name: TEXT.entity,
    aliases: [],
    type: "organisation",
    domain: "technology",
    summary: "An example organisation for the offline suite.",
    firstSeen: YESTERDAY,
    lastMentioned: TODAY,
    mentionCount: 5,
    status: "active",
    importance: "normal",
    locked: false,
  },
  {
    id: OTHER_ENTITY_ID,
    name: TEXT.otherEntity,
    aliases: [],
    type: "project",
    domain: "technology",
    summary: null,
    firstSeen: YESTERDAY,
    lastMentioned: TODAY,
    mentionCount: 2,
    status: "active",
    importance: "normal",
    locked: false,
  },
];

const entityAppearances: MirroredAppearance[] = [
  { id: "00000000-0000-4000-8000-0000000000c4", entityId: ENTITY_ID, reportDate: TODAY, contextSnippet: "Example snippet.", relevanceScore: 6 },
];

const contacts: MirroredContact[] = [
  {
    id: CONTACT_ID,
    identifier: TEXT.contact,
    name: "Example Sender",
    relationship: "service",
    priority: "normal",
    contextNotes: null,
    firstSeen: YESTERDAY,
    updatedAt: NOW,
    locked: false,
    emailCount: 3,
  },
];

const topics: MirroredTopic[] = [
  {
    id: TOPIC_ID,
    headline: TEXT.topic,
    domain: "technology",
    runningSummary: "An example running summary.",
    firstSeen: YESTERDAY,
    lastUpdated: TODAY,
    status: "active",
    updateCount: 2,
    sources: ["example-source"],
  },
];

const stores = {
  reports,
  extractions,
  notes,
  corrections: contextDoc.corrections,
  contextDoc: [contextDoc],
  entities,
  entityAppearances,
  contacts,
  topics,
} satisfies Record<string, { id: string }[]>;

export const ETAG = "blackhole-fixture";

function snapshotOf(etag: string, from: Record<string, { id: string }[]>) {
  return {
    version: etag,
    etag,
    mode: "full",
    base: null,
    generatedAt: NOW,
    stores: from,
    ids: Object.fromEntries(Object.entries(from).map(([name, rows]) => [name, rows.map((row) => row.id)])),
  };
}

/** The body `/api/offline/snapshot` answers a full pull with (`#lib/server/snapshotCache.ts`). */
export const SNAPSHOT = snapshotOf(ETAG, stores);

// --- the layout lane's snapshot: the same data with several rows per table ---
//
// The offline lanes address single rows by their text (`getByText(F.TEXT.note)`, "1 change"), so
// they keep the small snapshot above. A layout is only judged on tables that have more than one
// row, on a report with every urgency and section, and on a document with its section rail.

const BULK_ROWS = 6;
const bulkId = (kind: number, i: number) => `00000000-0000-4000-8000-${kind.toString(16).padStart(6, "0")}${i.toString(16).padStart(6, "0")}`;
const bulk = <T>(make: (i: number) => T): T[] => Array.from({ length: BULK_ROWS }, (_, i) => make(i + 1));
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

const bulkExtractions = bulk((i) => extraction(bulkId(0x10, i), `Example bulk headline ${i}`));
const entry = (text: string, i: number) => ({ html: `<p>${text}</p>`, refIds: [bulkExtractions[i % BULK_ROWS].id] });

const layoutReports: MirroredReport[] = [
  {
    ...reports[0],
    structured: {
      personal: [
        { urgency: "critical", entries: [entry("Example critical entry that needs an answer today.", 0)] },
        { urgency: "high", entries: [{ html: `<p>${TEXT.personal}</p>`, refIds: [EXTRACTION.personal] }, entry("Example high entry about a placeholder appointment.", 1)] },
        { urgency: "normal", entries: [entry("Example normal entry with a longer sentence so the line has to wrap inside the article column on a narrow track.", 2), entry("Another example normal entry.", 3)] },
        { urgency: "mentions", entries: [entry("Example mention.", 4)] },
      ],
      news: [
        { group: "World", entries: [{ html: `<p>${TEXT.news}</p>`, refIds: [EXTRACTION.news] }, entry("A second example world story.", 5)] },
        { group: "Home", entries: [entry("An example local story.", 0)] },
      ],
      intel: [
        { domain: "Technology", entries: [{ html: `<p>${TEXT.intel}</p>`, refIds: [EXTRACTION.intel] }, entry("A second example technology item.", 1)] },
        { domain: "Science", entries: [entry("An example science item.", 2)] },
      ],
      alsoNoted: [],
    },
  },
  report(YESTERDAY, {
    personal: [],
    news: [],
    intel: [{ domain: "Technology", entries: [{ html: `<p>${TEXT.yesterday}</p>`, refIds: [] }] }],
    alsoNoted: [],
  }),
  ...[2, 3, 4, 5, 6].map((n) => report(daysAgo(n), { personal: [], news: [], intel: [{ domain: "Technology", entries: [entry(`Example entry from ${n} days ago.`, n)] }], alsoNoted: [] })),
];

const layoutContextDoc: MirroredContextDoc = {
  ...contextDoc,
  doc: {
    generatedAt: `${YESTERDAY}T03:30:00.000Z`,
    date: YESTERDAY,
    path: "context-builder/output/example.md",
    chars: 300,
    fullContextHtml: [1, 2, 3, 4, 5].map((n) => `<h1>${n}. Example section ${n}</h1><p>${n === 3 ? TEXT.harvest : `Example harvested text for section ${n}.`}</p>`).join(""),
    sections: [1, 2, 3, 4, 5].map((n) => ({ key: String(n), title: n === 3 ? "3. Interests" : `${n}. Example section ${n}`, html: `<p>${n === 3 ? TEXT.harvest : `Example harvested text for section ${n}.`}</p>`, chars: 40 })),
  },
  corrections: [
    ...contextDoc.corrections,
    ...bulk((i) => ({ ...contextDoc.corrections[0], id: bulkId(0x12, i), target_key: String((i % 5) + 1), statement: `Example correction statement ${i}.` })),
  ],
};

const layoutStores = {
  reports: layoutReports,
  extractions: [...extractions, ...bulkExtractions],
  notes: [
    ...notes,
    ...bulk((i): NoteRow => ({ ...notes[0], id: bulkId(0x13, i), content: `Example bulk note ${i}: a placeholder line long enough to wrap inside a card.`, scope: i % 2 ? "global" : "personal", revision_count: 0 })),
  ],
  corrections: layoutContextDoc.corrections,
  contextDoc: [layoutContextDoc],
  entities: [
    ...entities,
    ...bulk((i): MirroredEntity => ({ ...entities[1], id: bulkId(0x14, i), name: `Example Bulk Entity ${i}`, summary: i % 2 ? "An example summary." : null, mentionCount: i })),
  ],
  entityAppearances: [
    ...entityAppearances,
    ...bulk((i): MirroredAppearance => ({ ...entityAppearances[0], id: bulkId(0x15, i), reportDate: daysAgo(i), contextSnippet: `Example snippet ${i}.` })),
  ],
  contacts: [...contacts, ...bulk((i): MirroredContact => ({ ...contacts[0], id: bulkId(0x16, i), identifier: `sender${i}@example.com`, name: `Example Sender ${i}` }))],
  topics: [...topics, ...bulk((i): MirroredTopic => ({ ...topics[0], id: bulkId(0x17, i), headline: `Example bulk story ${i}` }))],
} satisfies Record<string, { id: string }[]>;

export const LAYOUT_ETAG = "blackhole-layout-fixture";
export const LAYOUT_SNAPSHOT = snapshotOf(LAYOUT_ETAG, layoutStores);

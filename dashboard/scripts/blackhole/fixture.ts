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
  MirroredRelation,
  MirroredReport,
  MirroredRule,
  MirroredTopic,
} from "../../src/lib/offline/repo.ts";
import type { NoteRow } from "../../src/lib/notes/api.ts";

/** The local date, as the pages compute "today". */
export const TODAY = new Date().toLocaleDateString("sv-SE");
export const YESTERDAY = new Date(Date.now() - 86_400_000).toLocaleDateString("sv-SE");
/** A day the mirror has no report for, for the "no report" state and its Run pipeline form. */
export const EMPTY_DAY = "2020-01-01";

export const EXTRACTION = {
  personal: "00000000-0000-4000-8000-000000000001",
  news: "00000000-0000-4000-8000-000000000002",
  intel: "00000000-0000-4000-8000-000000000003",
} as const;

export const NOTE_ID = "00000000-0000-4000-8000-0000000000a1";
export const TRASHED_NOTE_ID = "00000000-0000-4000-8000-0000000000a2";
export const RULE_ID = "00000000-0000-4000-8000-0000000000b1";
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
  rule: "Keep the example briefing short on weekends.",
  harvest: "Example harvested interests section.",
  entity: "Example Organisation",
  otherEntity: "Example Project",
  contact: "sender@example.com",
  topic: "Example standing story",
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

const reports: MirroredReport[] = [
  report(TODAY, {
    personal: [{ urgency: "high", entries: [{ html: `<p>${TEXT.personal}</p>`, refIds: [EXTRACTION.personal] }] }],
    news: [{ group: "World", entries: [{ html: `<p>${TEXT.news}</p>`, refIds: [EXTRACTION.news] }] }],
    intel: [{ domain: "Technology", entries: [{ html: `<p>${TEXT.intel}</p>`, refIds: [EXTRACTION.intel] }] }],
    alsoNoted: [],
  }),
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

const rules: MirroredRule[] = [{ id: RULE_ID, key: "example_rule", value: TEXT.rule, source: "user", updatedAt: NOW }];

const contextDoc: MirroredContextDoc = {
  id: "current",
  run: {
    id: "00000000-0000-4000-8000-0000000000f1",
    mode: "update",
    started_at: `${YESTERDAY}T03:00:00.000Z`,
    completed_at: `${YESTERDAY}T03:30:00.000Z`,
    items_indexed: 10,
    output_path: "context-builder/output/example.md",
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
  standing: rules,
  corrections: [
    {
      id: "00000000-0000-4000-8000-0000000000f2",
      target_kind: "document",
      target_key: "3",
      operation: "amend",
      statement: "Example correction statement.",
      supersedes_text: null,
      rationale: null,
      source: "user",
      created_at: NOW,
    },
  ],
  counts: { contacts: 1, entities: 2, standing_context: 1, indexed_email: 10, indexed_keep: 2 },
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

const entityRelations: MirroredRelation[] = [
  {
    id: "00000000-0000-4000-8000-0000000000c3",
    fromId: ENTITY_ID,
    toId: OTHER_ENTITY_ID,
    relationType: "maintains",
    confidence: 0.9,
    firstSeen: YESTERDAY,
    lastSeen: TODAY,
    confirmed: true,
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
  rules,
  corrections: contextDoc.corrections,
  contextDoc: [contextDoc],
  entities,
  entityRelations,
  entityAppearances,
  contacts,
  topics,
} satisfies Record<string, { id: string }[]>;

export const ETAG = "blackhole-fixture";

/** The body `/api/offline/snapshot` answers a full pull with (`#lib/server/snapshotCache.ts`). */
export const SNAPSHOT = {
  version: "blackhole-fixture",
  etag: ETAG,
  mode: "full",
  base: null,
  generatedAt: NOW,
  stores,
  ids: Object.fromEntries(Object.entries(stores).map(([name, rows]) => [name, rows.map((row) => row.id)])),
};

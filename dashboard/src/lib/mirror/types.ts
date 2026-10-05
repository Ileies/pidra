/**
 * Row and wire shapes shared by the snapshot builder (`lib/server/offline/snapshot.ts`) and the
 * offline layer (`lib/offline/*`, service worker). One definition so the two sides cannot drift:
 * changing a field means updating the builder query and any `repo.ts` reader. Type-only (the worker
 * imports it), so nothing here may import a value.
 */

import type { RenderedReport } from "#lib/server/reports.js";
import type { IngestFailure } from "#lib/pipeline.js";
import type { QuickAction } from "#lib/report/types.js";

/** Every mirrored store keys its rows on a plain string `id`. */
export interface Keyed {
  id: string;
}

/** How a request goes out: `net()` in a page, a bounded `fetch` in the worker. */
export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

/** The body of `/api/offline/snapshot`. */
export interface SnapshotBody {
  version: string;
  etag: string;
  mode: "full" | "delta";
  /** The version the delta is relative to; null for a full snapshot. */
  base: string | null;
  generatedAt: string;
  /** Full: every row. Delta: only the rows that differ from `base`. */
  stores: Partial<Record<string, Keyed[]>>;
  /** Every id each store holds now, in both modes. What the client prunes against. */
  ids: Partial<Record<string, string[]>>;
}

/** One report day as the mirror holds it. `id` is the date. */
export interface MirroredReport {
  id: string;
  date: string;
  report: {
    shortSummary: string | null;
    itemCount: number | null;
    itemsIncluded: number | null;
    itemsFiltered: number | null;
    tokensIn: number | null;
    tokensOut: number | null;
    aiCalls: number | null;
    webSearchesRun: number | null;
    createdAt: string | null;
  } | null;
  /** No `step_errors`: attempt stacks can quote raw source content, so they never leave the server
   *  and the report page passes `ErrorCard` an empty list offline. */
  pipelineRun: {
    status: "running" | "completed" | "failed";
    failedStep: string | null;
    startedAt: string | null;
    completedAt: string | null;
    durationMs: number | null;
  } | null;
  /** Sources that never delivered on the run behind this report (the warning above the briefing).
   *  Derived from `step_errors` server-side and stripped to source name and kind: no error text. */
  ingestFailures: IngestFailure[];
  structured: RenderedReport | null;
  reportHtml: string | null;
  ratings: Record<string, string>;
  /** The quick actions still on offer or already done. Absent on a report mirrored before they existed. */
  actions?: QuickAction[];
}

export interface MirroredCorrection {
  id: string;
  target_kind: string;
  target_key: string;
  operation: string;
  statement: string;
  supersedes_text: string | null;
  rationale: string | null;
  source: string;
  created_at: string;
}

export interface MirroredEntity {
  id: string;
  name: string;
  aliases: string[];
  type: string | null;
  domain: string | null;
  summary: string | null;
  firstSeen: string | null;
  lastMentioned: string | null;
  mentionCount: number;
  status: string;
  importance: string;
  locked: boolean;
}

export interface EntityAppearance {
  id: string;
  reportDate: string | null;
  contextSnippet: string | null;
  relevanceScore: number | null;
}

export interface MirroredAppearance extends EntityAppearance {
  entityId: string;
}

export interface MirroredContact {
  id: string;
  identifier: string;
  name: string | null;
  relationship: string | null;
  priority: string;
  contextNotes: string | null;
  firstSeen: string | null;
  updatedAt: string | null;
  locked: boolean;
  /** Seeded once from the Context Builder's corpus, then owned by the live pipeline. */
  emailCount: number;
}

export interface MirroredTopic {
  id: string;
  headline: string;
  domain: string;
  runningSummary: string | null;
  firstSeen: string;
  lastUpdated: string;
  status: string;
  updateCount: number;
  sources: string[];
}

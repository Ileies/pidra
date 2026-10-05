/**
 * The shapes the snapshot endpoint and the offline layer both name. Type-only on purpose: the
 * server builds these rows, the browser and the service worker store and read them, and a copy on
 * each side is how the two drift apart. Nothing here may import a value, so the worker can use it.
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
  /**
   * Which sources never delivered on the run behind this report - the warning above the briefing.
   * Derived from `step_errors` at the snapshot endpoint and stripped to a source name and a kind
   * there, so this carries the fact without carrying the error text the mirror must not hold.
   */
  ingestFailures: IngestFailure[];
  structured: RenderedReport | null;
  reportHtml: string | null;
  ratings: Record<string, string>;
  /** The quick actions still on offer or already done. Absent on a report mirrored before they existed. */
  actions?: QuickAction[];
}

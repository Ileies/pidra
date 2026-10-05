// Shared run context and the failure wrapper used by the four phases (fetch, extract, synthesize,
// finalize), which run.ts calls in that order.
import type { loadConfig } from "../config";
import type { CheckpointState } from "../checkpoint";
import { logError } from "../errors";

/** What every phase of one run shares. */
export interface RunCtx {
  mode: CheckpointState["mode"];
  /** The live checkpoint; phases update their own slice of it. */
  state: CheckpointState;
  config: Awaited<ReturnType<typeof loadConfig>>;
  /** The context_builder_runs row, absent on a dry run. */
  dbRunId: string | undefined;
  /** UTC day key of this run. */
  today: string;
  fromIndex: boolean;
}

/**
 * Runs one step of a phase so that a failure is logged under `phase:<name>` and the run goes on with
 * `fallback`, which is what every fetch and extraction step wants: one source being down must not
 * cost the others.
 */
export async function safePhase<T>(name: string, fallback: T, step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (err) {
    await logError(`phase:${name}`, err);
    return fallback;
  }
}

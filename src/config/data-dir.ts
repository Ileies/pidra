// Where the app keeps what it writes at runtime: Context Builder output, its progress and error
// logs, and the Keep token. Role: the single resolver for DATA_DIR on the root side.
import { resolve } from "node:path";

/**
 * The app root: the repo checkout locally, `/var/www/pidra` on pronix. In the source tree it is two
 * levels up from this file (`src/config/`). The server bundles sit directly in the root on pronix,
 * so `scripts/build-server.ts` defines `process.env.PIDRA_BUNDLE` at build time and the root is the
 * bundle's own directory. Bun substitutes `import.meta.dir` with that directory at run time.
 */
export const PROJECT_ROOT = process.env.PIDRA_BUNDLE ? import.meta.dir : resolve(import.meta.dir, "../..");

/**
 * `DATA_DIR` is absolute on pronix (`/var/lib/pidra`, set in the unit) and defaults to `./data` in
 * the checkout. A relative value resolves against the repo root, not the cwd: the dashboard runs
 * from `dashboard/`, the bridge and the jobs from the root, and they must agree on one directory.
 * The dashboard resolves it the same way (dashboard/src/lib/server/contextBuilder.ts).
 */
export const DATA_DIR = resolve(PROJECT_ROOT, process.env.DATA_DIR ?? "data");
export const CONTEXT_BUILDER_DIR = resolve(DATA_DIR, "context-builder");
/** Read per call, not at import: the env may be set after this module loads (tests do). Overridable on its own; relative overrides resolve against the cwd. */
export function contextBuilderOutputDir(): string {
  return process.env.CONTEXT_BUILDER_OUTPUT_DIR
    ? resolve(process.env.CONTEXT_BUILDER_OUTPUT_DIR)
    : resolve(CONTEXT_BUILDER_DIR, "output");
}

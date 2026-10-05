/**
 * The deterministic checks between a news desk's answer and the report.
 *
 * Catches the two ways a desk can mislead without a second model call: citing a URL its search never
 * returned, and presenting an old story as today's (`happened_at` outside the window).
 *
 * Nothing here drops a story. It records a verdict (`NewsValidation`, stored in
 * `extracted_json.validation`), and `pipeline/gate.ts` turns that into a named reason, so a held-back
 * story is still visible on `/[date]/triage`. Called from `news/run.ts` and `news/store.ts`.
 *
 * Pure, so the rules are testable without a database or an API key. `types` holds the shapes,
 * `url` the cleaning of links and prose, `checks` the per-story verdicts, `duplicates` the
 * same-story comparison across desks and days.
 */
export * from "./checks";
export * from "./duplicates";
export * from "./types";
export * from "./url";

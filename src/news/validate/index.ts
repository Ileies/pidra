/**
 * The deterministic checks between a news desk's answer and the report.
 *
 * A desk is a model with a search engine, and the two ways it can mislead are well known: it can
 * cite something it never read, and it can present an old story as today's. Neither needs a
 * second model call to catch. The search tool reports every URL it returned, so a story whose
 * sources are all absent from that list was not taken from the search. And every story carries
 * the date of its development, so a stale one can be told apart from a fresh one.
 *
 * Nothing here drops a story. It records a verdict on the story (`NewsValidation`), and the Phase 3
 * gate turns that into a named reason, so a story the reader never saw is still visible on
 * `/[date]/triage` with the reason it was held back.
 *
 * Pure, so the rules are testable without a database or an API key. `types` holds the shapes,
 * `url` the cleaning of links and prose, `checks` the per-story verdicts, `duplicates` the
 * same-story comparison across desks and days.
 */
export * from "./checks";
export * from "./duplicates";
export * from "./types";
export * from "./url";

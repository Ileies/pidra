# Scoring formulas

The gate, trust-score and entity-pruning math as actually implemented, checked against the live code on 2026-09-29. **If this drifts from the code, trust the code** - these numbers are exactly the kind of thing that changes during tuning without anyone remembering to update a doc.

## Relevance gate (`src/pipeline/gate.ts`)

Newsletter items: `effective_relevance = relevance_score * trust_score + corroboration_bonus`, inclusion threshold `>= 3.0`. A `teaser_only` check runs before this score (added 2026-10-01): an item whose extracted `substance` is `"teaser"` is held back regardless of what it scored, since a teaser scoring exactly 3.0 at the threshold was reaching synthesis with nothing in it to report.

This is only the newsletter path. The gate is a single pure function with a named `GateReason` per outcome (see `CLAUDE.md`, "Every item the pipeline discards says why"), and the other two source types have their own rules, not this formula:
- `personal_email` / `sms`: category-based, not score-based.
- `web_news` (the news desks): its own validation checks (source actually returned by search, inside the window, not a duplicate, not already told) run before a score threshold of 3 (4 if the story is about somewhere other than the reader's home).

Read `src/pipeline/gate.ts` directly for the exact current rules per source type - this is the one place they're guaranteed not to disagree with what `/[date]/triage` shows.

## Source trust score (`src/pipeline/weekly-source-scoring.ts`)

`trust_score = clamp(0.5, 2.0, composite_score_30d / 5)`, where the composite score is a rolling 30-day figure. A 7-day vs. 30-day comparison sets `quality_trend` to `improving` / `declining` / `stable`.

This replaced an earlier conditional-bump design (`if include_rate > 0.6 and avg_relevance > 3.8, +0.10 ...`) that's no longer in the code - don't reintroduce it without checking why it changed.

## Entity graph pruning (`src/pipeline/entity-pruning.ts`)

- Dormant entities (not `importance = high`, not locked by a correction) are archived after 60 days of absence.
- Archived entities are deleted after 180 days if `mention_count <= 2`; `entity_mentions` cascades on delete via FK, so no separate cleanup step is needed.

There is no relation graph in the current schema (`entity_relations` was dropped - it had zero confirmed edges, zero evidence, and was never read by synthesis) - entity pruning only ever deals with the `entities` row itself.

## Topic lifecycle (`src/pipeline/topic-lifecycle.ts`)

- An active topic with no story update for 7 days becomes dormant.
- A dormant topic with no story update for 30 days becomes archived. Archived topics and their summaries are retained.
- Dormant and archived topics that match a new newsletter claim are offered to Section 1 for a same-story decision. A confirmed continuation reactivates the existing row.
- `resolved` requires evidence of an ending from today's claim. Inactivity alone never resolves a topic.
- At most `TOPIC_ACTIVE_CAP` (15) topics are `active` at once. A candidate that would grow that count - a `new_topics` entry, or a dormant/archived topic Section 1 revives back to active - only gets in at capacity by out-valuing `weakestActiveTopic()` (ranked by `importance`, tie-broken by lower `update_count`, then older `last_updated`); a strict win (`isMoreValuable()`) bumps the incumbent to dormant, a tie or loss leaves the candidate at its current status, untouched. Candidates are ranked by `importance` (`high|normal|low`, model-supplied, default `normal`) and processed strongest-first. Resolving or refreshing an already-active topic doesn't touch the active count, so those always apply directly.

## Feedback signals

Implicit behavioral detection (calendar/todo writes correlating with a report item) lives in `src/pipeline/implicit-feedback.ts`; explicit +/- ratings go through `rateExtraction()`. Read those files directly for the current weighting - this doc intentionally doesn't restate exact numbers here since they're the most likely to have moved since last checked.

## Web search slots (`src/search/slots.ts`)

Three Brave-search slots feed Section 1, conceptually:
1. Deep-dive on the day's top active topic or highest-corroboration story.
2. Dormant high-importance entity monitor.
3. Self/project reputation rotation (one target per day from a maintained list in `notes`, scope `search`).

Slots 4 (pre-meeting research) and 5 (user-specified search intent) are deliberately unbuilt - see `CLAUDE.md`, "What not to build (yet)".

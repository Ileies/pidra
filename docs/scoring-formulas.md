# Scoring formulas

The gate, trust-score, pruning and topic-lifecycle math as implemented, checked against the code on 2026-10-02. **If this drifts from the code, trust the code**: these numbers change during tuning without anyone updating a doc.

## Relevance gate (`src/pipeline/gate.ts`)

The gate is one pure function with a named `GateReason` per outcome (see "Every item the pipeline discards says why" in `docs/architecture-rules.md`). Read `gate.ts` for the exact current rules per source type; it is the one place guaranteed not to disagree with `/[date]/triage`.

**Newsletter items:** `effective_relevance = relevance_score * trustMultiplier + corroboration_bonus`, passed at `>= 3.0`. `trustMultiplier` is `trust_score`, except that an item rated `>= 4` (`TRUST_PROOF_SCORE`) uses `max(1, trust_score)`: a distrusted source can never pull a strong item below its own score, while a trusted one still lifts it. Two checks run before the score:

- `skipped_by_extraction`: extraction found nothing worth extracting.
- `teaser_only`: the extracted `substance` is `"teaser"`. A teaser scoring exactly 3.0 used to reach synthesis with nothing in it to report.

**Corroboration bonus**, by the number of distinct raw items sharing an entity with the item (itself included): 2 sources +0.3, 3 sources +0.7, 4 or more +1.0, otherwise 0.

**`personal_email` / `sms`:** category-based, not score-based. `spam` and `general_news` are dropped; `automated` passes only at `critical` or `high` urgency; anything else passes on a positive score.

**`web_news` (the news desks):** the validation checks written by `src/news/validate/` run first, in this order: unverified source, outside the window, duplicate of another desk, already reported on an earlier day (word overlap, then the `news_dedup` judge call, which also marks same-event duplicates across desks). Then a significance threshold of 3, or 4 for a story about somewhere other than the reader's home.

## Source trust score (`src/pipeline/weekly-source-scoring.ts`)

`trust_score = clamp(0.5, 2.0, composite / 5)`, so a composite of 5/10 is neutral (1.0), 10/10 is 2.0 and 0/10 is 0.5. The composite is `max(30-day, 7-day)` when the last 7 days hold at least 5 items (`RECENT_MIN_ITEMS`), otherwise the 30-day figure: an improving source is noticed within a week, decay stays slow.

The daily composite per source (`src/pipeline/source-signal.ts`, written by `phase6/source-scoring.ts`) is `min(10, avg_neutral_relevance / 5 * 7 + include_rate * 3)`. It must not depend on trust, or low trust feeds itself through the gate: `neutral_relevance = relevance_score + corroboration_bonus` (no trust factor), and an item counts as included if it was in the report, or was `below_threshold` only because of trust (neutral relevance `>= 3`). `scripts/rescore-sources.ts` rebuilds `source_daily_scores` and every trust score from stored extractions with the current formulas (dry run by default, `--apply` writes); run it after changing them. `quality_trend` compares the item-weighted 7-day composite with the 30-day one: more than 0.5 above is `improving`, more than 0.5 below `declining`, otherwise `stable`.

This replaced an earlier conditional-bump design (`if include_rate > 0.6 and avg_relevance > 3.8, +0.10 ...`). Do not reintroduce it without checking why it changed.

## Entity lifecycle

Entities move through three stages, with the first running at the end of each pipeline run and the others in the Sunday 02:00 `prune` job (`src/pipeline/entity-pruning.ts`):

- **Dormant:** an `active` entity not mentioned for 14 days (`src/pipeline/phase6/dormant.ts`). A new mention reactivates a dormant or archived entity. Entities locked by a correction are skipped in both directions.
- **Archived:** a dormant entity not mentioned for 60 days, unless `importance = high`.
- **Deleted:** an archived entity absent for 180 days with `mention_count <= 2`. `entity_mentions` cascades on delete via FK.

There is no relation graph (`entity_relations` was dropped: zero confirmed edges, zero evidence, never read by synthesis), so pruning only deals with the `entities` row itself.

## Topic lifecycle (`src/pipeline/topic-lifecycle.ts`)

- An active topic with no story update for 7 days becomes dormant (`TOPIC_DORMANT_DAYS`); a dormant one with none for 30 days becomes archived (`TOPIC_ARCHIVE_DAYS`). Archived topics and their summaries are retained.
- Dormant and archived topics matching a new newsletter claim are offered to Section 1 for a same-story decision. A confirmed continuation reactivates the existing row.
- `resolved` requires evidence of an ending in today's claim. Inactivity alone never resolves a topic.
- At most `TOPIC_ACTIVE_CAP` (15) topics are `active`. A candidate that would grow that count (a `new_topics` entry, or a dormant/archived topic revived to active) only gets in at capacity by out-valuing `weakestActiveTopic()`: ranked by `importance`, tie-broken by lower `update_count`, then older `last_updated`. A strict win (`isMoreValuable()`) bumps the incumbent to dormant; a tie or loss leaves the candidate at its current status. Candidates are ranked by model-supplied `importance` (`high|normal|low`, default `normal`) and processed strongest first. Resolving or refreshing an already-active topic never touches the count.

## Feedback signals

Implicit behavioral detection (calendar and to-do writes correlating with a report item) lives in `src/pipeline/implicit-feedback.ts`; explicit +/- ratings go through `rateExtraction()`. Read those files for the current weighting; the numbers move too often to restate here.

## Web search slots (`src/search/slots.ts`)

Three Brave-search slots feed Section 1:

1. **Topic deep-dive:** the active topic with the highest `update_count`.
2. **Watched entity monitor:** entities with `importance = high` (the Watch control on `/entities/[id]`) that have gone 10 or more days unmentioned. Rotates by least recently searched (`last_watch_search`) so one target cannot monopolise the shared Brave quota.
3. **Self/project reputation:** one target per day, rotating by the run date's day of year (so a rerun of a past day searches what that day did) through `notes` with scope `search`.

Slots 4 (pre-meeting research) and 5 (user-specified search intent) are deliberately unbuilt (see "What's next" in `CLAUDE.md`).

# Now

See `docs/todo/README.md` for the conventions this list follows.

## Repeat news

- Finish the repeat-news plan: Section 1 `already_told` (the briefing side, so a newsletter claim already told in the news section or an earlier briefing is not repeated) and the sweep of stale `running` runs are not built yet. The news side (`src/pipeline/told.ts`, `src/news/judge.ts`) is in.

## Small code smells

- A Phase 2 re-run leaves one `extractions` row per attempt, and `candidateMails` (`src/actions/propose/mails.ts`) groups around it. Decide whether Phase 2 should replace or supersede earlier attempts.
- `routes/notes.ts`: a `base_updated_at` conflict still applies the edit (last write wins) and `_conflict` is informational. Decide whether that is the intended offline behavior or the dashboard should surface it.

# Now

See `docs/todo/README.md` for the conventions this list follows.

## Repeat news

- Finish the repeat-news plan: the sweep of stale `running` runs is not built yet.

## Small code smells

- A Phase 2 re-run leaves one `extractions` row per attempt, and `candidateMails` (`src/actions/propose/mails.ts`) groups around it. Decide whether Phase 2 should replace or supersede earlier attempts.
- `routes/notes.ts`: a `base_updated_at` conflict still applies the edit (last write wins) and `_conflict` is informational. Decide whether that is the intended offline behavior or the dashboard should surface it.

# Now

See `docs/todo/README.md` for the conventions this list follows.

## Small code smells

- A Phase 2 re-run leaves one `extractions` row per attempt, and `candidateMails` (`src/actions/propose/mails.ts`) groups around it. Decide whether Phase 2 should replace or supersede earlier attempts.
- `routes/notes.ts`: a `base_updated_at` conflict still applies the edit (last write wins) and `_conflict` is informational. Decide whether that is the intended offline behavior or the dashboard should surface it.
- Two `SourceFailure` types (`src/evaluation/baseline.ts` with `step`, `src/pipeline/phase1-ingest.ts` without): merge or rename.
- `as any` casts remain in `src/pipeline/phase6/*` and `src/pipeline/entity-context.ts`.
- `scripts/jev-baseline.ts` and the `*-dry-run.ts` scripts are not wired into `package.json`: add scripts or delete them.
- The `report` prompt in `src/ai/surfaces.ts` has a quick-action paragraph between two list bullets.
- The extract-email schema asks for a summary of at most 60 chars while `context-builder/pipeline/extract-email.ts` slices to 80: align them.

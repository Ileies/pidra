# Now

See `docs/todo/README.md` for the conventions this list follows.

- **[INFRA]** Confirm the extraction rubric tightened on 2026-09-30 and 2026-10-01 (`src/ai/prompts/extraction.ts`, rationale in `docs/prompt-tuning-context.md`) actually spreads newsletter `relevance_score`. Before the change 65 of 96 items scored exactly 3, so most sat on the 3.0 gate line and daily gate pass rates swung 27%-48%. After another week of real mornings, re-run the same query (score histogram per day plus gate pass rate) and close this out if the distribution is wider and the pass rate steadier

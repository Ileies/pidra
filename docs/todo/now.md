# Now

See `docs/todo/README.md` for the conventions this list follows.

- **[INFRA]** Confirm the extraction rubric tightened on 2026-09-30 and 2026-10-01 (`src/ai/prompts/extraction.ts`, rationale in `docs/prompt-tuning-context.md`) actually spreads newsletter `relevance_score`. Before the change 65 of 96 items scored exactly 3, so most sat on the 3.0 gate line and daily gate pass rates swung 27%-48%. After another week of real mornings, re-run the same query (score histogram per day plus gate pass rate) and close this out if the distribution is wider and the pass rate steadier
- **[INFRA]** Try the question-answer loop on a real queue: answer a question, read the outcome on `/questions/closed`, revert a removal with `revert_context_revision`
- **[INFRA]** Test coverage is thin. Nothing unit-tests the offline outbox/sync logic (the blackhole suite exercises it end to end, not unit by unit)
- **[INFRA]** Confirm the Section 2 fix for old question answers becoming daily action items (`src/ai/prompts/section2.ts`, 2026-10-01). An answer is background only, items that merely share a category or a missing due date are never linked, and an answer yields an item only when a `personal_item` from one of its senders is in today's input. Success: the OCG bullet stops repeating daily and no cross-item linking appears over a few mornings. If the owner wants the "continue chapters 4-7" reminder to keep appearing, relax the sender-in-today's-input rule

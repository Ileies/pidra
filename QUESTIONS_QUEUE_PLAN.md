# Questions queue redesign plan

Status: P0-P2 and P3's first bullet are done and live (2026-09-30); what's below is only what's still open. The full diagnosis, the per-item implementation notes, and the verification steps for finished work live in git history (commits for each phase) and in the code comments next to what they explain - not repeated here. See "Done so far" for pointers.

## Objective and boundaries (still governs everything below)

No source in this plan - old or new - gets a quota, a minimum, or a target frequency; each one emits a candidate only when it actually has something worth asking, and on a day where nothing does, the queue simply gets nothing new. `src/questions/store.ts` stays the single writer; `src/questions/reconcile.ts` keeps owning dedup/merge/resolve; nothing here should touch report synthesis's own logic, only what it's given to read.

## Open work

### P2: new sources of genuine daily uncertainty

- [ ] Stale info referenced ambiguously: a contact or entity whose stored context is old, that new mail refers to in a way that doesn't cleanly match what's stored. Not attempted - unblocked, just out of scope for the pass that shipped the entity-graph source.
- [ ] Topic/desk drift: only when a news desk's items are measurably and consistently rated low over time, not on any fixed interval. Blocked on `report_actions`/feedback data existing to measure it (per `docs/todo/now.md`'s quick-actions item).

### P3: observability and tuning

- [ ] Run the pipeline for at least a week and review `scripts/questions-dry-run.ts` output plus `question_events` with the owner before tuning further, consistent with CLAUDE.md's standing direction to judge the system against real mornings rather than untested assumptions. Done when a week of real question-queue behavior (counts, quality, resolution reasons) can be reviewed from data instead of gut feel.

### P4: close the entity-graph loop (larger, optional)

- [ ] When an item question about a sender is answered, feed the answer into entity resolution as well as `contacts`, so answering "who is X" also enriches whatever entity that sender is tied to, not just the sender directory. Scope this only after P3's week-long review has happened, since it touches the entity graph directly.

## Done so far (see git log / code for detail, not repeated here)

- **P0** - fixed two data-corruption bugs: `answerQuestion()` no longer writes raw answer text verbatim into `contacts.relationship` (now classified via `answer_classification` prompt); `WEEKLY_REVIEW_PROMPT` no longer forces exactly 3 questions; review-answer -> note synthesis now traceable via `notes.source_question_ids`. `src/questions/store.ts`, `src/ai/prompts/answer-classification.ts`, `src/pipeline/weekly-review.ts`.
- **P1** - gave the existing generators better inputs: per-email classification now sees `known_contacts` and recent `notes`, cutting false-positive `unknown_context` flags; quick-actions prompt loosened per owner's 2026-09-30 clarification. `src/pipeline/phase2-extract.ts`, `src/ai/prompts/extraction.ts`, `src/ai/prompts/actions.ts`.
- **P2 (entity-graph source)** - `src/pipeline/entity-questions.ts`'s `lowConfidenceEntityCandidates()` adds a third candidate source (low-confidence entities), riding the existing daily pipeline with no schema change. Entity-vs-mail distinction added to `reconcile.ts`'s payload and `QUESTIONS_PROMPT`.
- **P3 (outcome log)** - `question_events` append-only table (migration `0031_question_events.sql`) logs every asked/reasked/rewritten/answered/dismissed/reopened/merged/resolved/dropped event with its reason, since `questions.status_detail` only ever holds the current one. `src/db/schema.ts`, `src/questions/store.ts`.

## Primary references

- `src/questions/store.ts` - single writer for `questions` and `question_events`; `applyPlan()`, `answerQuestion()`, `dismissQuestion()`, `reopenQuestion()`
- `src/questions/reconcile.ts` - `QUESTIONS_PROMPT`, `reconcileQueue()`, `buildPlan()`, `mechanicalPlan()` fallback
- `src/pipeline/entity-questions.ts` - `lowConfidenceEntityCandidates()`, the P2 entity-graph source
- `src/pipeline/phase4-questiongate.ts` - `candidatesFor()`, `openQuestions()`, blocking/poll loop for Section 2
- `src/db/schema.ts` - `questions`, `question_events`
- `docs/architecture-rules.md` - "Questions are one standing queue, answered one at a time" (owner decision, 2026-09-28)
- `docs/todo/now.md` - adjacent quick-actions mismatch and question-gate test-coverage gaps
- `scripts/questions-dry-run.ts` - standalone reconcile-tuning entry point

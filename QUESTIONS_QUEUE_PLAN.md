# Questions queue redesign plan

Status: proposed, 2026-09-30. Written after the owner reported two problems: questions aren't arriving daily as expected, and the last batch of answers produced changes to stored data the owner was unhappy with. This is a diagnosis and implementation checklist, not authorization to start editing prompts or schema.

## Diagnosis

**Why questions aren't arriving daily.** Only two things ever add candidates to `questions` (`src/questions/store.ts` is the sole writer; both paths go through `reconcileQueue` in `src/questions/reconcile.ts`):

1. Item candidates: `phase2-extract.ts` classifies each personal email/SMS in isolation (raw content only, no known-contacts list, no notes) and flags `unknown_context = true` via `PERSONAL_EMAIL_PROMPT` (`src/ai/prompts/extraction.ts:48-71`). `phase4-questiongate.ts`'s `candidatesFor()` turns flagged extractions into candidates, but only for senders not already asked about. Once a sender is answered once, `answerQuestion()` writes them into `contacts`, so the same sender never triggers again. **This source is self-depleting by design**: the better the system knows you, the fewer of these appear, and on a day with no unfamiliar-sender mail it produces zero.
2. Review candidates: `weekly-review.ts` runs once a week (Sunday 20:00 per `docs/operations.md`), and `WEEKLY_REVIEW_PROMPT` (`weekly-review.ts:8-12`) hardcodes *"generate exactly 3"* reflection questions regardless of whether the week produced three things worth reflecting on.

Nothing else generates a candidate. The entity graph, source trust scores, topic drift, and contradictions in standing context/notes are never read as a source of genuine uncertainty worth asking about, despite that being the system's stated compounding mechanism (CLAUDE.md, tool 1). Net effect: real cadence is "rare unfamiliar-sender pings" plus "3 mandatory questions once a week," not daily.

**Why the last answers produced unwanted changes.** Two concrete bugs:

- `answerQuestion()` (`src/questions/store.ts:188-218`) writes the raw answer text **verbatim** into `contacts.relationship` for any single-sender item question, with no normalization and no "this is spam / not worth remembering" outcome. An answer like "no idea, looks like spam, ignore it" becomes the permanent relationship descriptor for that sender, and that field is read back into `known_contacts` on every future reconcile call.
- Review answers pass through a second, separate LLM call (`SYNTHESIS_PROMPT`, `weekly-review.ts:14-18`) that paraphrases them into "insight notes" with no link back to the original question or answer (`absorbReviewAnswers()`, `weekly-review.ts:86-111`). A paraphrase that drifts or over-generalizes becomes permanent standing context with no way to trace it back to what was actually said, and it then feeds forward into both the next reconcile call's `notes` input and report synthesis.

## Objective and boundaries

Fix the two data-corruption bugs first, independent of everything else. Then widen what can generate a candidate question, without ever forcing a count. No source in this plan - old or new - gets a quota, a minimum, or a target frequency; each one emits a candidate only when it actually has something worth asking, and on a day where nothing does, the queue simply gets nothing new. The daily-cadence complaint is fixed by giving the system more daily-running places to find a genuine question (P2), not by obligating it to produce one. `src/questions/store.ts` stays the single writer; `src/questions/reconcile.ts` keeps owning dedup/merge/resolve; no change here should touch report synthesis's own logic, only what it's given to read.

## P0: stop the data corruption (small, do first)

- [x] Replace the verbatim `contacts.relationship` write in `answerQuestion()` with a small structured pass on the answer text (`extractJson` against a new `answer_classification` prompt section, `{relationship: string, spam_or_irrelevant: boolean}` strict schema). Only upserts `contacts.relationship` when there is a real relationship to record; skips the contacts write when `spam_or_irrelevant` or `relationship` is empty. A classification failure is caught and logged, never rolled back into the already-recorded answer. Source-trust feed-in was left as a future idea, not done here - out of scope for "small, do first". (`src/questions/store.ts`, `src/ai/prompts/answer-classification.ts`, registered as `answer_classification` in `src/ai/prompt-catalog.ts` so it's dashboard-approvable like every other stage prompt.)
- [x] Drop the forced count in `WEEKLY_REVIEW_PROMPT`: the model now returns 0-3 questions, with explicit permission to return none on a quiet week. `runWeeklyReview()` no longer treats an empty array as a parse failure - only a genuine JSON parse error aborts the run. (`src/pipeline/weekly-review.ts`)
- [x] Made review-answer -> note synthesis traceable: `notes.source_question_ids` (new `uuid[]` column, migration `0030_notes_source_question_ids.sql`) records which review question(s) a note came from. A single answered question skips `SYNTHESIS_PROMPT` entirely and becomes a note close to verbatim (`"${question} ${answer}"`, no model call) instead of being paraphrased; `SYNTHESIS_PROMPT` only runs to combine two or more answers into a pattern, and the resulting notes carry every contributing question's id. (`src/pipeline/weekly-review.ts`, `src/notes/store.ts`, `src/db/schema.ts`)
- [x] Re-ran `bun run scripts/questions-dry-run.ts` (0 open questions live right now - matches the original "not receiving any" report) and a throwaway answer/classification round-trip against the live DB: a spam-like answer left `contacts` untouched, a genuine relationship answer wrote a normalized description, not the raw text. `tsc --noEmit`, `check-skill-writes.ts` and `check-route-surfaces.ts` all pass.

Done when a spam/irrelevant answer no longer pollutes `contacts`, a light week no longer forces 3 questions, and every note created from a review answer carries a pointer back to its source question. **P0 is done**, verified against the live DB 2026-09-30.

## P1: give the existing generators better inputs

- [x] Passed `known_contacts` and recent `notes` (scope `personal`/`contact`/`global`, capped at 30) into the per-email classification call: `buildPersonalEmailPrompt` (`src/ai/prompts/extraction.ts`) now takes an optional `ClassificationContext`, loaded once per run by `loadClassificationContext()` in `src/pipeline/phase2-extract.ts` rather than per item. `PERSONAL_EMAIL_PROMPT`'s rules now define `sender_known`/`unknown_context` against that context instead of the address alone, and tell the model to null out `question_for_user` when the context already answers it. Did not touch `phase4-questiongate.ts`'s fallback wording itself - fewer `unknown_context` false positives means it fires less often, which was the actual goal.
- [x] Resolved `docs/todo/now.md`'s quick-actions mismatch note. The owner clarified the 2026-09-26 "most of the time it should not add action buttons" guidance was said out of over-caution, not as a deliberate steady state, and that quick actions currently under-fire in practice. Loosened `QUICK_ACTIONS_PROMPT` (`src/ai/prompts/actions.ts`): replaced "when in doubt, propose nothing" with "propose it when it clearly fits one of the four kinds", and narrowed the `add_todo` security-alert carve-out so a security mail asking for real follow-up work (rotate a key, file a report) still qualifies - only routine automated notices (sign-in alerts, verification codes) are excluded now. That carve-out being too broad was the root cause of the 2026-09-25 mismatch example. Kept Section 2's own "flag it explicitly" rule (`src/ai/prompts/section2.ts`) as the wider net, per owner's direction - did not drop it.

Done when `question_for_user` wording is judged against what the system already knows, not against the email alone. **P1 is done**, `bun run check` and the full test suite (103 pass) green, 2026-09-30.

## P2: new sources of genuine daily uncertainty

Do not add a scheduled or quota-based generator here; only add sources that emit a candidate when there is real ambiguity to resolve, so "how many questions today" stays an honest reflection of how much is actually uncertain.

- [ ] Entity graph contradictions or low-confidence entities: when the weekly entity-pruning pass (Sunday 02:00, `docs/operations.md`) or daily extraction surfaces two sources disagreeing about an entity, or a new entity stays low-confidence past some threshold of mentions, emit a candidate.
- [ ] Stale info referenced ambiguously: a contact or entity whose stored context is old, that new mail refers to in a way that doesn't cleanly match what's stored.
- [ ] Topic/desk drift: only when a news desk's items are measurably and consistently rated low over time (once `report_actions`/feedback data exists to measure this, per `docs/todo/now.md`'s quick-actions item), not on any fixed interval.
- [ ] Each new source plugs into the existing `candidatesFor()` -> `reconcileQueue()` -> `applyPlan()` pipeline as a new `kind`, or as a new `item`-like candidate; no change needed to `reconcile.ts`'s merge/resolve logic itself unless a new `kind` requires its own wording rules.

Done when at least one non-email, non-weekly-review source can produce a candidate, and it only does so when there's a real, explainable reason.

## P3: observability and tuning

- [ ] Add an outcome log for questions (mirroring `report_actions`): asked, answered, dismissed, merged, resolved, with reasons, so the reconcile step's merge/resolve/drop decisions can be judged on real data rather than assumption.
- [ ] Run the pipeline for at least a week after P0-P2 land and review `scripts/questions-dry-run.ts` output plus the new outcome log with the owner before tuning further, consistent with CLAUDE.md's standing direction to judge the system against real mornings rather than untested assumptions.

Done when a week of real question-queue behavior (counts, quality, resolution reasons) can be reviewed from data instead of gut feel.

## P4: close the entity-graph loop (larger, optional)

- [ ] When an item question about a sender is answered, feed the answer into entity resolution as well as `contacts`, so answering "who is X" also enriches whatever entity that sender is tied to, not just the sender directory. Scope this only after P0-P3 are live and reviewed, since it touches the entity graph directly.

## Primary references

- `src/questions/store.ts` - single writer for `questions`; `answerQuestion()`, `dismissQuestion()`, `reopenQuestion()`
- `src/questions/reconcile.ts` - `QUESTIONS_PROMPT`, `reconcileQueue()`, `buildPlan()`, `mechanicalPlan()` fallback
- `src/pipeline/phase2-extract.ts`, `src/ai/prompts/extraction.ts` - `PERSONAL_EMAIL_PROMPT`, `unknown_context`/`question_for_user` fields
- `src/pipeline/phase4-questiongate.ts` - `candidatesFor()`, blocking/poll loop for Section 2
- `src/pipeline/weekly-review.ts` - `WEEKLY_REVIEW_PROMPT`, `SYNTHESIS_PROMPT`, `absorbReviewAnswers()`
- `src/db/schema.ts` - `questions` table and `QuestionSource`/`QuestionRevision` types
- `docs/architecture-rules.md` - "Questions are one standing queue, answered one at a time" (owner decision, 2026-09-28)
- `docs/operations.md` - cron schedule (daily pipeline 06:30, weekly review Sunday 20:00, entity pruning Sunday 02:00)
- `docs/todo/now.md` - adjacent quick-actions mismatch and question-gate test-coverage gaps
- `scripts/questions-dry-run.ts` - standalone reconcile-tuning entry point

# Jev integration plan for PIDRA

Status: proposed, 2026-09-30. This is an implementation checklist, not authorization to send personal data to a new provider or to change the live relevance gate.

## Objective and boundaries

Use TypeSafe AI's Jev for narrow, typed judgments that improve the morning briefing's recall and ordering. Keep extraction of claims and facts, generation of prose and action parameters, source verification, arithmetic, dates, permissions, and writes with their current owners. Introduce one decision task at a time after a measured shadow trial.

Success means more must-cover stories reach the reader, fewer unhelpful items consume the report's limited space, and every exclusion remains explainable on `/[date]/triage`. Lower model cost alone is not a reason to switch.

## Dependency order

1. Establish a trustworthy baseline and close existing handoff gaps.
2. Add one server-side Jev adapter and an audit trail, with no effect on reports.
3. Evaluate public news judgments, then public newsletter claim ranking.
4. Promote only decisions that beat the existing path on held-out mornings.
5. Consider personal data only after a separate data-retention decision.

## P0: make the baseline trustworthy

- [x] Finish and verify the Phase 2 rerun dedup fix in `src/pipeline/phase2-extract.ts`. Repeated runs preserve successful extraction IDs and the number of story rows, so downstream source scores and corroboration do not gain duplicate inputs. A successful retry replaces a failed placeholder with the complete result.
- [x] Close the Section 1 handoff gap in `src/pipeline/phase5-synthesis.ts`: `ctx.newsletterItems.slice(0, 30)` can omit gate-passed items without recording that they were never sent to synthesis. Define an explicit, stable ordering and persist a distinct `outside_synthesis_capacity` handoff outcome for every such item. `/[date]/triage` must distinguish it from a story that synthesis saw and passed over.
- [ ] Record the actual candidate set, order, gate verdict, synthesis handoff, report citation, and later feedback for each evaluated item. Preserve the pipeline's final report and extraction ownership rules.
  - The per-run ledger exists: table `run_candidates`, written by `src/evaluation/run-candidates.ts` after Phase 6. One row per newsletter claim or news story of the run, with the gate verdict, handoff and order, the News editor input position, citation and outcome. It has no foreign key to `extractions`, so it survives a Phase 2 rerun. Applied to the production database on 2026-10-07, so it fills from the next run. `scripts/jev-baseline.ts` reads the frozen verdicts from this table when the run has rows (`verdictSource: "ledger"`) and falls back to live extractions for older runs; text and feedback are still joined from live extractions by id.
  - A local, read-only snapshot exporter now joins newsletter and news deliveries, their extraction decisions, citations, feedback, absent newsletter deliveries and source failures: `bun run scripts/jev-baseline.ts YYYY-MM-DD --output /private/path/DATE.json`. It writes with private permissions and refuses to overwrite. This is a review aid, not yet a per-run ledger: a later rerun can change the date's extraction rows, and news editor input order is not persisted. Absence is only an observation because many newsletters have a weekly or irregular cadence.
- [ ] Complete the planned Brave news-desk research build before using Jev results to judge news coverage. Search recall and URL provenance must be measured independently of Jev's judgment.
- [ ] Collect at least 14 representative completed mornings for evaluation, including light and heavy days, home and world news, essays and short newsletters, repeats, and cross-domain stories. Track missing newsletter deliveries and failed desks separately so a missing source is not counted as a ranking error.
- [ ] Make a review set from those mornings: manually label must-cover, useful, and unhelpful stories; note stories found on a general front page or local front page that PIDRA missed. Keep a held-out portion that is not used to tune rubrics or thresholds.

Done when the baseline can answer, for every sampled story, whether it was never found, failed extraction, failed the gate, fell outside synthesis capacity, or was seen and omitted by synthesis.

## P1: build a controlled Jev decision layer

- [x] Confirm `JEV_KEY` is configured in the local `.env`. This verifies the existing setup only; SDK calls and missing-key fallback remain untested.
- [x] Add the official `@typesafe-ai/sdk` as a server-only dependency. Pin a tested SDK release and a versioned model ID such as `jev-1.13.0`, rather than relying on the moving `jev-latest` alias for production thresholds. Pinned SDK 0.6.0 and model `jev-1.13.0`.
- [x] Smoke-test the SDK under Bun with a synthetic state, a Choice, a Score, and a Noul. Check response validation, timeout, cancellation, 429 and 529 retries, and behavior when the API key is absent. Keep credentials on the server; never add them to dashboard code or the offline snapshot. The live synthetic call returned the pinned model and all three answers; transport tests cover the failure paths.
- [x] Add a single `src/ai/jev.ts` adapter. Give it bounded concurrency, a total call deadline, explicit model and rubric versions, response validation, usage and latency accounting, and a typed error result. Do not route Jev through the OpenAI client or give it OpenAI-only options such as `store: false`.
- [x] Add per-task `off | shadow | active` configuration. Default every task to `off`; a missing key, timeout, invalid response, or provider failure must fall back to the existing path and record the failure. Env `JEV_MODE_<TASK>` in `src/ai/jev.ts`; failures return a typed error result and are written by the ledger.
- [x] Extend the approved prompt catalog with Jev question instructions and criteria. Resolve the active version at run time through `src/ai/active-prompts.ts`; proposals remain inactive until reviewed on `/prompts`. Section `jev_news_impact` (a JSON rubric) and `src/ai/jev-rubrics.ts`; the other tasks get a section when their experiment starts.
- [x] Add a separate decision-evaluation ledger keyed by run, task, source item or extraction, model version, and rubric version. Store the answer, full option probabilities, confidence where supplied, input-token use, latency, error, mode, and whether it influenced the report. Store a state hash and minimal source IDs, not another copy of raw mail or article text. Make retries idempotent. Table `jev_decisions` and writer `src/ai/jev-ledger.ts`; the table is applied to the production database (2026-10-07).
- [x] Show provider-specific Jev calls, cost, latency, and failures on `/runs`. Shown on `/runs/[id]` as a "Jev decisions" card (tokens, latency and failures; no dollar cost until Jev pricing is configured). Do not silently add Jev input tokens to `daily_reports.tokens_in`, which currently mixes other model calls without provider attribution.
- [x] Write synthetic tests for malformed answers, missing probability keys, provider failure, retry duplication, and shadow-mode noninterference. Run `bun run check` and the relevant `bun test` cases before committing.

Done when a shadow decision can be replayed and inspected without changing an extraction, gate verdict, report, question, action, or skill execution.

## P2: first experiment, public news

Input: one desk story after `src/news/validate.ts` has checked URLs and dates, plus a small set of prior public headlines. Exclude personal context, notes, email, SMS, and the harvested document.

- [ ] Ask separate, literal questions for public impact and material novelty. Define ordered Score levels with concrete examples from the labeled set. Ask about event identity only for duplicate pairs shortlisted by deterministic code.
- [ ] Preserve URL verification, date-window checks, location rules, and source-link attachment in code. Jev must not invent a URL, decide whether a timestamp is inside the window, or certify that a source was read.
- [ ] Run in shadow mode for at least 14 representative mornings. Compare Jev's scores with desk significance, the existing gate, reader feedback, and the manually labeled must-cover set. Break results down by desk, home versus abroad, topic, language, and new versus continuing story.
- [ ] Evaluate ordering among already eligible stories first. Do not make Jev a news exclusion gate while the News section is the reader's only news source.
- [ ] For duplicate matching, retain an explicit uncertain outcome. A high-scoring duplicate judgment must not collapse two distinct major developments. Any later exclusion needs a named gate reason and a visible explanation in triage.
- [ ] Publish a held-out comparison with must-cover recall, top-story ordering, false duplicate rate, useful-story precision, p50/p95 added latency, fallback count, and cost per completed morning.

Promotion gate: no observed loss of a labeled must-cover story on the held-out days, no incorrect collapse of a must-cover story, and a clear improvement in ordering or duplicate handling. If this gate fails, keep the current news path and retain the evaluation findings.

## P3: second experiment, newsletter claim ranking

Input: the compact `headline`, `key_claim`, topic tags, entities, and source from each already extracted newsletter claim in `src/pipeline/phase2-extract.ts`. Do not send whole newsletter bodies for this task. Start only with claims from publicly available material. A paid, private, or personally tailored newsletter needs the same provider-retention decision as P4 before any of its text reaches Jev.

- [ ] Define separate Jev judgments for relevance to the published Section 1 priorities, public significance, novelty relative to recent report headlines, and cross-domain interest. Keep the source trust multiplier and corroboration bonus as code in `src/pipeline/gate.ts`.
- [ ] Compare three rankings over the exact same candidate sets: current behavior, a deterministic order using existing extraction and trust scores, and Jev-assisted order. Test against the 30-item Section 1 capacity after the P0 handoff fix.
- [ ] Check German and Chinese examples explicitly. Jev's published guidance says accuracy outside English can differ; do not infer a shared threshold from English results.
- [ ] Calibrate Jev Score and Choice outputs on held-out examples. Do not substitute a Jev Score directly for the existing 1-5 `relevance_score` or reuse the current `>= 3` gate threshold.
- [ ] Decide in code how the separate dimensions affect ordering. Version that formula and show its inputs in the evaluation ledger. Preserve named reasons for any story that would cease to reach synthesis.
- [ ] Review disagreements manually, especially low-headline-interest stories with high value to an active project, and claims that connect two priority fields.

Promotion gate: at least the baseline's must-cover recall within Section 1 capacity, a measured reduction in unhelpful top-30 items, and no unexplained exclusions. If those conditions do not hold, do not activate the Jev ranking.

## P4: conditional personal-data pilot

This phase is blocked until the owner makes an explicit provider and retention decision. TypeSafe's public documentation says customer input is not used for model training, but its standard privacy policy permits retention; zero data retention is described as an enterprise offering. PIDRA's existing `store: false` contract with OpenAI does not automatically apply to TypeSafe. Do not send personal mail, SMS, contacts, notes, diary, or harvested context to Jev under the public-account assumptions.

- [ ] Obtain and record the applicable retention terms and data-processing arrangement, or define a genuinely non-personal, redacted input that still passes usefulness tests. Verify the chosen API path's actual terms before enabling any personal-data call.
- [ ] If approved, run a shadow trial beside the existing `personal_classification` call. Use a Choice for `personal_important | general_news | automated | spam`, a separate urgency judgment, and separate event, to-do, and unknown-context flags.
- [ ] Leave deadline parsing and time comparison to generation plus code. Leave `action_required` and `question_for_user` generation with the existing model until an alternative produces those fields reliably. Apply the existing `emailEffectiveRelevance()` and `decideGate()` policies in one place.
- [ ] Label urgent and adversarial mail, unknown senders, receipts, invitations, newsletters misdelivered to a personal mailbox, and non-English messages. Measure missed critical/high items and lost questions separately from ordinary classification accuracy.
- [ ] Promote only if held-out results support the same or better recall for urgent personal items and no new silent discard path. Uncertain or failed Jev decisions must use the current classifier.

## P5: selective follow-on work

- [ ] If duplicate graph entities are a measured problem, generate candidate pairs using names and aliases in code, then trial Jev only on the shortlisted pairs. Keep `contacts` an email sender directory, not a social graph; preserve correction locks and provenance before any merge.
- [ ] If repeated question-queue duplicates remain after existing reconciliation, trial a pairwise same-issue judgment. Keep generated rephrasings, close reasons, and fail-open behavior in `src/questions/reconcile.ts`.
- [ ] If quick actions are still too eager after a week of actual usage, trial Jev as a post-proposal usefulness check. It must not write parameters, dates, or titles, and every discarded proposal needs a reason in `report_actions`.
- [ ] Consider assistant tool routing only if measured tool-selection errors or latency justify an extra serial call. The current surface allowlist and `executeSkill()` checks remain authoritative.
- [ ] Do not add Jev as a cloud reranker for the private report archive as part of this project. The separate archive-search plan calls for local embeddings and an explicit privacy decision before cloud retrieval.

## Evaluation rules for every activation

- [ ] Pre-register the task's metrics, held-out examples, latency budget, and promotion threshold before tuning its rubric.
- [ ] Keep full Choice and Score probability distributions. Calibrate each task and language separately; Noul has no separate `confidence` field.
- [ ] Test prompt-injection attempts in source text. Treat source content as data and keep exact calculations, identifiers, URL checks, and write permissions in code.
- [ ] Compare provider failures and fallback behavior with normal mornings. A failing decision call must not make the daily report fail or imply that an ingest source was healthy when it was not.
- [ ] Activate one task at a time with a reversible configuration switch. Review at least a week of live outcomes before activating the next task.
- [ ] Keep proposed rubric changes under `/prompts` human approval. Never let weekly meta-runs auto-activate a Jev question or change a gate threshold.

## Primary references

- [TypeSafe introduction and question types](https://docs.typesafe.ai/introduction)
- [TypeSafe model specifications, pricing, version aliases, and language guidance](https://docs.typesafe.ai/models)
- [TypeSafe confidence guide](https://docs.typesafe.ai/confidence)
- [Jev 1.13 known limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13)
- [TypeSafe API reference](https://docs.typesafe.ai/api)
- [Official TypeScript SDK](https://github.com/typesafe-ai/typesafe-sdk-js)
- [TypeSafe legal guide](https://docs.typesafe.ai/legal) and [privacy policy](https://typesafe.ai/legal/privacy-policy)

Project touchpoints: `src/pipeline/gate.ts`, `src/pipeline/phase2-extract.ts`, `src/pipeline/phase3-context.ts`, `src/pipeline/phase5-synthesis.ts`, `src/news/validate.ts`, `src/questions/reconcile.ts`, `src/actions/propose.ts`, `src/ai/active-prompts.ts`, `src/ai/prompt-catalog.ts`, `src/db/schema.ts`, and `docs/prompt-tuning-context.md`.

# TEST_PLAN - closing the test gap

Status (2026-10-05): Phase 1 committed (`dcb8004`, `2c4be66`). Phase 2 written and passing but NOT yet committed (see "Progress and what is left" at the end). Phases 3 to 5 not started. Delete this file when the last phase lands (open leftovers move to `docs/todo/`).

Source: a coverage audit on 2026-10-05, after Phases 1 to 9 of `REFACTOR_PLAN.md` landed. Counts below were measured then: `bun test ./tests` runs 213 tests in 22 files, all passing.

## Problem

1. **The root tests are not part of `bun run check`.** `scripts/check.ts` runs `tsc`, `skill-writes`, `route-surfaces`, `file-size` and the dashboard check. Nothing runs `tests/`, and the `commit` skill trusts that check, so a regression in `gate.ts`, `news/validate` or any other tested module can be committed without a failure.
2. **The root `test` script is broken.** `package.json` has `"test": "bun test"`. Since the workspace merge a bare `bun test` also discovers `dashboard/tests/`, which needs `--conditions=browser`: 59 failures and 3 errors. `bun test ./tests` is the working invocation (already noted in memory).
3. **Coverage is thin where bugs are expensive.** Tested today: the pure and deterministic parts (gate, report JSON, news validate/format/config, topic lifecycle, retry, SMS auth, prompt variables, RSS, corrections, source signal). Untested: the stores, the pipeline phases, the skill gate, the Brave quota, the action proposal logic and all of `context-builder/`.
4. **The refactor moved a lot of untested code.** Phases 1 to 9 split large files (`server/index.ts` into `server/routes/*`, `propose.ts` into `actions/propose/*`, `schema.ts` into `db/schema/*`) and were verified only by `tsc`, the dashboard check and the existing tests.

## Goals and non-goals

- Root tests gate every commit, with no flaky additions.
- Tests pin the invariants that fail silently (see Phase 2), not line coverage for its own sake.
- Tests stay fast: the whole root suite should stay well under 5 seconds, and use no network and no real database unless Phase 4 is explicitly approved.
- Non-goal: unit tests for LLM prompts or model output. That is judged against real mornings (see `docs/todo/now.md`).
- Non-goal: a coverage percentage target.

## Ground rules

- Follow the `CLAUDE.md` commit workflow: small thematic commits through the `commit` skill, `bun run check:quick` while iterating, full `bun run check` before each commit.
- Run root tests as `bun test ./tests`, never a bare `bun test`.
- Do not hand-edit `docs/**`; pass the reasoning to `/commit` so `docs-committer` writes it.
- Use placeholders only (`user@example.com`), never real PII, in fixtures.
- Prefer testing pure functions that already exist. If a function needs a small extraction to become testable, do the extraction as its own behavior-neutral commit first.
- Never mock the OpenAI client or Brave with logic that mirrors production. Inject a fake `fetch` or a stub at the module boundary and assert on the request that would have been sent.
- Concurrent sessions can share this working dir: re-verify `git status` and stage only files this plan touched.
- Risk tags: L low, M medium, H high.

---

## Phase 1 - Make the existing suite count

| ID | Change | Risk |
|---|---|---|
| 1.1 | Add a `unit tests` step to `scripts/check.ts` running `bun test ./tests`, next to `file-size`. It runs concurrently with the other steps, so wall time barely changes (the dashboard blackhole suite dominates) | L |
| 1.2 | Change the root `package.json` `test` script to `bun test ./tests` so `bun run test` works. Leave the dashboard's own `test:components` alone | L |
| 1.3 | Keep `--quick` runs including the new step: it takes under a second, so there is no reason to skip it | L |
| 1.4 | Confirm the step fails the check when a test fails (break one assertion locally, run `bun run check:quick`, then revert) | L |

Done when `bun run check` fails on a deliberately broken root test and passes on a clean tree.

## Phase 2 - Invariants that fail silently

Each item below is a rule stated in `CLAUDE.md` or `docs/architecture-rules.md` that nothing currently checks. One test file per concern.

| ID | Target | What to pin | Risk |
|---|---|---|---|
| 2.1 | `pickSections` (`src/pipeline/long-term-context.ts:70`) | Splits on `# 1.` to `# 5.`; a document in any other shape yields an empty string for the routed sections, and each spec routes the sections the two synthesis calls expect. Include headings inside code fences and a missing `# 3.` | L |
| 2.2 | Context-builder output verification (`context-builder/phases/synthesize.ts`) | A malformed patch is rebuilt in full; one that still fails leaves `document` null; a well-formed one is recorded. May need the verification predicate extracted into a pure function first (own commit) | M |
| 2.3 | `braveSearch` / `braveContext` (`src/search/brave.ts`) | Every request, including a retry, reserves one of the 30 daily calls; a full quota fails closed without making the request; the day key rolls over at the UTC boundary. Inject `fetch` and a fake quota store | M |
| 2.4 | `executeSkill` / `resolvePendingSkill` (`src/skills/execute.ts`) | Risk-level gating: unknown skill returns `unknown_skill`, a confirmation-gated skill returns `pending_confirmation` without running, a `critical` skill never executes, a failing skill returns `failed` and still records the execution | M |
| 2.5 | OpenAI wrapper (`src/ai/openai.ts`) | Every call carries `store: false` and `service_tier: "flex"`; `withFlexRetry` retries 429 with backoff and gives up after the cap; no `temperature` or `max_tokens` is ever sent; the speech call is the documented exception. Assert on the outgoing request body | M |
| 2.6 | Static guard for the OpenAI rules | A script in the `check-skill-writes` style that fails if a second `new OpenAI(` appears outside `src/ai/openai.ts`, or if the hosted `web_search` tool string appears anywhere in `src/`. Optional: fold into 2.5 if simpler | L |

Done when each invariant has a test that fails if the rule is broken. Verify each once by mutating the code locally.

## Phase 3 - Pure logic the refactor split out

These modules are already pure or nearly so, so tests need no database.

| ID | Target | What to pin | Risk |
|---|---|---|---|
| 3.1 | `actions/propose/matching.ts` | `similar` and `sameThing` thresholds; `parseWhen` for all-day, timed, and malformed input; `eventDays` and `isPast` across a DST change in `Europe/Berlin`; `inCalendar` duplicate detection | L |
| 3.2 | `actions/propose/check.ts` | `check()` accepts a valid proposal, rejects duplicates, past events and unresolved references; `clean` strips links | L |
| 3.3 | `questions/reconcile.ts` | `mechanicalPlan`, `buildPlan` and `capCreated` (cap of `MAX_NEW_QUESTIONS_PER_RUN`); `emptyPlan` is a no-op; answered or unknown ids in a model answer are ignored, not applied | L |
| 3.4 | `pipeline/phase4-questiongate.ts` and `phase5-synthesis.ts` parsing | Synthesis output parsing per `docs/operations.md`: well-formed, truncated and extra-text outputs. Extract the parser if it is not already a pure function | M |
| 3.5 | `news/research.ts` and `news/run.ts` | Desk assembly and the discard/failure reporting rule: a desk that fails or is discarded appears in the report instead of vanishing. Stub the Brave client from 2.3 | M |
| 3.6 | `ingest/google.ts` and `ingest/imap.ts` | Mapping of raw items to ingested rows and the failure path (`ingest-failures` already covers part of this). Use recorded fixtures, no network | M |
| 3.7 | `ai/surfaces.ts` | Assistant surface selection and prompt approval boundaries from `docs/architecture-rules.md` | M |

Done when the listed modules have at least one passing and one failing-input test each.

## Phase 4 - Stores against a real database (needs a decision)

`notes/store.ts`, `questions/store.ts`, `actions/store.ts` and `news/store.ts` hold the behavior that matters (notes as the mutable layer, reports are final, questions queue). Their logic is mostly SQL, so a mock proves little.

- **Option A (recommended):** a throwaway Postgres per test run (a local `postgres` via the Nix dev shell, or a schema created per run on pronix under a separate database name). Tests apply `src/db/schema/` and run against it. Cost: setup work and a new check dependency, so keep this suite out of `bun run check` and run it with a separate `bun run test:db`.
- **Option B:** extract the pure decision parts of each store (merge rules, status transitions) and test only those. Cheaper, covers less.
- **Hard rule:** never point tests at the production database on pronix. The runner must refuse to start unless the connection string names a database ending in `_test`.

Targets once a database is available: reports are final (a stored report cannot be rewritten), note edits create the expected history, a question transitions only along valid statuses, and the daily Brave quota row increments atomically.

## Phase 5 - Context builder and dashboard server side

| ID | Change | Risk |
|---|---|---|
| 5.1 | A `context-builder/` test folder covering `sources/email.ts` parsing, `output/db-writer.ts` idempotence (seed twice, no duplicates; uses Phase 4 if approved) and the update-mode proportional merge | M |
| 5.2 | Route-level tests for the 69 dashboard server files, prioritised by risk: auth and cookie handling (`authManagerDenied`, `setAuthCookie`), the SMS route (`src/server/routes/sms.ts`, including the unset-secret rejection), then the endpoints that write. Test the handler functions directly with a constructed `Request`, no running server | M |
| 5.3 | Extend `scripts/check-route-surfaces.ts` style guards if a new class of route mistakes shows up while writing 5.2 | L |

## Order and commits

1. Phase 1 (one commit for the step, one for the script fix).
2. Phase 2, one commit per ID, starting with 2.1 and 2.4 (cheapest, highest value).
3. Phase 3, one commit per ID.
4. Phase 4 only after the owner picks Option A or B.
5. Phase 5 last.

## Owner decisions

- Phase 4: Option A (real test database) or Option B (pure extraction only)?
- 2.6: separate static guard, or fold it into the 2.5 test?
- Whether `docs/` should get a short testing section (what runs in `check`, how to run the DB suite). `docs-committer` can add it when Phase 1 lands.

## Verification

- After each phase: `bun test ./tests` is green and fast, `bun run check` passes, and for every new invariant test the rule was broken once locally to confirm the test fails.
- After Phase 1 the check output should show an `ok unit tests (<secs>s)` line.
- No new test may depend on the clock, the network, the order of other tests or the load on the machine (see the blackhole flake note in memory).

---

## Progress and what is left

Written 2026-10-05, mid-session, so a fresh context can pick up.

### Done

- **Phase 1:** committed. `unit tests` step in `scripts/check.ts`, root `test` script is `bun test ./tests`, `docs/operations.md` updated.
- **Phase 2, all six items written and passing (uncommitted):**
  - 2.1 `tests/long-term-context.test.ts` (`pickSections`, `loadLongTermContext` fallback past a patch document, legacy archive path).
  - 2.2 NOT done: the context-builder output verification in `context-builder/phases/synthesize.ts` is still untested (needs the verification predicate extracted into a pure function first, as its own commit).
  - 2.3 `tests/brave.test.ts` (30/day cap with a strict `<`, UTC rollover, every retry reserves, fail closed, 429 wait).
  - 2.4 `tests/execute-skill.test.ts` (gate order, audit rows, confirm/reject re-checks).
  - 2.5 `tests/openai-rules.test.ts` (store:false, flex, no temperature/max_tokens, retry policy, speech exception).
  - 2.6 `scripts/check-openai-rules.ts`, wired into `scripts/check.ts` as the `openai-rules` step.
  - Mutation-checked: each invariant test fails when its rule is broken locally.
- **Shared db mock:** `tests/fixtures/db.ts` (`dbModule`) mirrors the full export surface of `src/db`; all `mock.module("../src/db")` calls use it. Fixes an order-dependent failure (`Export named 'existingMessageIds' not found`) that `lookup + rss` already had.

### Bugs found and fixed on the way (uncommitted)

1. `src/skills/execute.ts`: the critical-skill rejection settled the audit row without a reason; it now goes through `reject()` like the other rejections.
2. `dashboard/src/lib/offline/outbox.ts` `queue()`: the optimistic effect was applied before the intent was stored, so a snapshot pull landing in between overwrote it and `reapplyPending` could not re-assert it (a restored note snapped back into the trash). Now the intent is stored first. Regression test in `dashboard/tests/offline-outbox.test.ts`.
3. `dashboard/src/lib/offline/intents.ts`: `report.read` apply and `patchReportsRating` did get-then-put of the whole report row, so a rating and a read receipt could overwrite each other. Both use `db.update` now. Regression test in `dashboard/tests/offline-intents.test.ts`.
4. Blackhole harness (`dashboard/scripts/blackhole/proxy.ts`, `verify.ts`, `steps.ts`, `lane.ts`): the new `report.read` write was unknown to the harness (forwarded to a database-less server, so the lane never reached "Synced" and crashed). One shared exported `WRITE` regex now covers it, `EXPECTED_WRITES` lists the two receipts, and the first-launch step scrolls to the end of today's report and waits for its receipt so it no longer depends on timing.

### Open

- **Blackhole flake, not understood:** the step `/notes: restore a note from the trash` still fails in about 3 of 5 full runs on current main (the restored note stays in the trash view for more than 2.5 s, although its restore is delivered). It passed 7 of 7 on the older commit `0c05a18` with fix 2 applied, so something in the newer `report.read` work or its interplay is involved. Instrumented timings showed "restore tapped" in 1 s and then no "note gone". Next idea: log the mirror row and `data.notes` after the tap in the failing lane, and check `useReadReceipt` / `navBadges.refresh` / `flush` interplay with `invalidateMirror`.
- **Commit:** nothing of the above is committed. Needs a passing full `bun run check` first (the user's rule: no test-work commit without a full check), then thematic commits: (1) `tests/fixtures/db.ts` + the six re-pointed test files, (2) Phase 2 tests + `check-openai-rules.ts` + the `check.ts` step + the `execute.ts` fix, (3) outbox ordering fix + test, (4) `intents.ts` atomic update + test, (5) blackhole harness. Do not stage other sessions' files (`ReadProgress.svelte` was theirs).
- **Cleanup:** two temporary worktrees exist under the scratchpad (`wt`, `wt2`); remove with `git worktree remove --force <path>` and `git worktree prune`.
- **Then:** Phase 2.2, Phase 3 (3.1 to 3.7), Phase 4 (needs the owner's decision: real test database or pure-function extraction), Phase 5.

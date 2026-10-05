# TEST_PLAN - closing the test gap

Status (2026-10-06): Phases 1 and 2 committed, Phase 4 (harness and the four stores) committed, Phase 3 partly done (3.1, 3.2, 3.3, the SYSTEM-block half of 3.4, 3.5, 3.6 and 3.7 committed; the Phase 5 half of 3.4 open), Phase 5 not started (see "Progress and what is left" at the end). Delete this file when the last phase lands (open leftovers move to `docs/todo/`).

Source: a coverage audit on 2026-10-05. Counts below were measured then: `bun test ./tests` runs 213 tests in 22 files, all passing.

## Problem

1. **The root tests are not part of `bun run check`.** `scripts/check.ts` runs `tsc`, `skill-writes`, `route-surfaces`, `file-size` and the dashboard check. Nothing runs `tests/`, and the `commit` skill trusts that check, so a regression in `gate.ts`, `news/validate` or any other tested module can be committed without a failure.
2. **The root `test` script is broken.** `package.json` has `"test": "bun test"`. Since the workspace merge a bare `bun test` also discovers `dashboard/tests/`, which needs `--conditions=browser`: 59 failures and 3 errors. `bun test ./tests` is the working invocation (already noted in memory).
3. **Coverage is thin where bugs are expensive.** Tested today: the pure and deterministic parts (gate, report JSON, news validate/format/config, topic lifecycle, retry, SMS auth, prompt variables, RSS, corrections, source signal). Untested: the stores, the pipeline phases, the skill gate, the Brave quota, the action proposal logic and all of `context-builder/`.
4. **A refactor moved a lot of untested code.** It split large files (`server/index.ts` into `server/routes/*`, `propose.ts` into `actions/propose/*`, `schema.ts` into `db/schema/*`) and were verified only by `tsc`, the dashboard check and the existing tests.

## Goals and non-goals

- Root tests gate every commit, with no flaky additions.
- Tests pin the invariants that fail silently (see Phase 2), not line coverage for its own sake.
- Tests stay fast: the whole root suite should stay well under 5 seconds, and use no network and no real database. Real-database tests (Phase 4) live in their own folder `tests-db/` and run in a separate `check` step.
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
| 3.5 | `news/research.ts` and `news/run.ts` (done, `tests-db/news-research.test.ts` and `news-run.test.ts`) | Desk assembly and the discard/failure reporting rule: a desk that fails or is discarded appears in the report instead of vanishing. Stub the Brave client from 2.3 | M |
| 3.6 | `ingest/google.ts` and `ingest/imap.ts` | Mapping of raw items to ingested rows and the failure path (`ingest-failures` already covers part of this). Use recorded fixtures, no network | M |
| 3.7 | `ai/surfaces.ts` | Assistant surface selection and prompt approval boundaries from `docs/architecture-rules.md` | M |

Done when the listed modules have at least one passing and one failing-input test each.

## Phase 4 - Stores against a real database (decided: Option A, 2026-10-05)

`notes/store.ts`, `questions/store.ts`, `actions/store.ts` and `news/store.ts` hold the behavior that matters (notes as the mutable layer, reports are final, questions queue). Their logic is mostly SQL, so a mock proves little.

**Decision:** a throwaway local Postgres, started and destroyed by the test run itself. It is part of `bun run check`, not a separate script. Option B (pure-function extraction only) is dropped; extract a pure function only where it makes a store easier to read, not as a testing substitute.

Measured on this machine (Postgres 17, 39 tables):

| Step | Time |
|---|---|
| `initdb --no-sync` | 0.60 s |
| start server | 0.12 s |
| create DB + load DDL | 0.14 s |
| stop | 0.10 s |
| whole cycle | about 1 s |
| per-test-file clone (`createdb -T`) | about 50 ms |
| memory while idle | about 66 MB, 7 processes |

So the step adds roughly 1.5 to 3 s to `check`, against about 70 s for blackhole. It also runs in `--quick`.

### Design

- **Instance:** `scripts/lib/test-postgres.ts` runs `initdb -D <tmp>/data -U test --auth=trust --no-sync -E UTF8`, then `pg_ctl start` with `-p <random free port> -k <short socket dir> -c fsync=off -c synchronous_commit=off -c full_page_writes=off -c listen_addresses=127.0.0.1 -c shared_buffers=32MB -c max_connections=50`. The socket dir must be a short path such as `mktemp -d /tmp/pgs.XXXX`: a path under the scratchpad exceeds the 107-byte unix socket limit. Stop with `pg_ctl -m immediate` and delete the data dir in a `finally`, also on SIGINT.
- **Schema:** `bun x drizzle-kit export --dialect postgresql --schema src/db/schema/index.ts --sql` (0.74 s), loaded through Bun's `SQL(...).unsafe(ddl)`. Do NOT use `drizzle-kit push` or the default config: `drizzle.config.ts` globs the whole schema directory including the re-exporting `index.ts`, so every table is seen twice and push exits 1. The exported DDL is generated each run, never committed, so it cannot drift from `src/db/schema/`. Load it into a template database `tpl`; each test file clones its own with `createdb -T tpl t_<name>` (about 50 ms).
- **Binaries:** `initdb`, `pg_ctl` and `createdb` come from the dev shell or `nix shell nixpkgs#postgresql_17`; resolve them from `PATH` first, then via `nix`. `psql` is not installed and not needed (load DDL through Bun). If no Postgres can be found, the step prints one clear line saying how to get it and fails; it never silently skips, because a skipped check is a false green.
- **Wiring:** a `db tests` step in `scripts/check.ts`, concurrent with the others. It starts the instance, exports `PIDRA_TEST_DATABASE_URL`, runs `bun test ./tests-db` and tears down. Real-DB tests live in their own folder (`tests-db/`), so `bun test ./tests` stays free of any database and stays at its 0.4 s. `package.json` gets `"test:db"` for running the step alone.
- **Wiring in tests:** each file calls a helper `useTestDatabase()` (in `tests-db/fixtures/`) that clones a database from the template, sets `process.env.DATABASE_URL` to it BEFORE `src/db` is first imported (the module throws at import when unset), and drops the clone in `afterAll`. Use a dynamic `await import("../src/notes/store")` after that call.
- **Hard rule:** never point tests at the production database on pronix. `useTestDatabase()` and the runner refuse to continue unless the host is `127.0.0.1` or a unix socket and the database name ends in `_test` or starts with `t_`. The clone names therefore all start with `t_`. A test run must also fail loudly if `DATABASE_URL` from `.env` is already set to anything else: the helper overwrites it, never reads it.

### Targets

Reports are final (a stored report cannot be rewritten), note edits create the expected revision history, a question transitions only along valid statuses, and the daily Brave quota row increments atomically (the `lt(calls, 30)` upsert, here against real SQL instead of the rendered-SQL inspection in `tests/brave.test.ts`). Also what the mocks cannot show: constraints (`user_settings_content_language_code`, `contacts_identifier_email_like`, `brave_daily_usage_calls_range`) actually reject bad rows, and `ON CONFLICT` paths behave.

### Open questions for the implementer

- `drizzle-kit export` must keep working on the pinned `1.0.0-rc` version; if it breaks on an upgrade, the `db tests` step fails at the export, which is the right place to notice.
- Whether CI or the deploy host has Postgres binaries is unknown; today only the dev machine runs `check`.

## Phase 5 - Context builder and dashboard server side

| ID | Change | Risk |
|---|---|---|
| 5.1 | A `context-builder/` test folder covering `sources/email.ts` parsing, `output/db-writer.ts` idempotence (seed twice, no duplicates; uses Phase 4 if approved) and the update-mode proportional merge | M |
| 5.2 | Route-level tests for the 69 dashboard server files, prioritised by risk: auth and cookie handling (`authManagerDenied`, `setAuthCookie`), the SMS route (`src/server/routes/sms.ts`, including the unset-secret rejection), then the endpoints that write. Test the handler functions directly with a constructed `Request`, no running server | M |
| 5.3 | Extend `scripts/check-route-surfaces.ts` style guards if a new class of route mistakes shows up while writing 5.2 | L |

## Order and commits

2. Phase 2, one commit per ID, starting with 2.1 and 2.4 (cheapest, highest value).
3. Phase 3, one commit per ID.
4. Phase 4 (Option A decided): first the harness (`scripts/lib/test-postgres.ts`, the `db tests` check step, `useTestDatabase()`, plus one smoke test proving a clone has all tables), as its own commit. Then one commit per store.
5. Phase 5 last.

## Owner decisions

- Phase 4: decided 2026-10-05, Option A (throwaway local Postgres inside `bun run check`).
- 2.6: separate static guard, or fold it into the 2.5 test?
- Whether `docs/` should get a short testing section (what runs in `check`, how to run the DB suite). `docs-committer` can add it.

## Verification

- After each phase: `bun test ./tests` is green and fast, `bun run check` passes, and for every new invariant test the rule was broken once locally to confirm the test fails.
- No new test may depend on the clock, the network, the order of other tests or the load on the machine (see the blackhole flake note in memory).

---

## Progress and what is left

Written 2026-10-05, mid-session, so a fresh context can pick up.

### Done

- **Phase 2, all six items written and passing and committed:**
  - 2.1 `tests/long-term-context.test.ts` (`pickSections`, `loadLongTermContext` fallback past a patch document, legacy archive path).
  - 2.2 `tests/context-builder-verified-document.test.ts`: the patch-then-rebuild-then-throw flow was extracted from `phases/synthesize.ts` into `phases/verified-document.ts` (`buildVerifiedDocument`, own commit); a good patch is kept, a malformed one is rebuilt in full, a rebuild that still fails throws.
  - 2.3 `tests/brave.test.ts` (30/day cap with a strict `<`, UTC rollover, every retry reserves, fail closed, 429 wait).
  - 2.4 `tests/execute-skill.test.ts` (gate order, audit rows, confirm/reject re-checks).
  - 2.5 `tests/openai-rules.test.ts` (store:false, flex, no temperature/max_tokens, retry policy, speech exception).
  - 2.6 `scripts/check-openai-rules.ts`, wired into `scripts/check.ts` as the `openai-rules` step.
  - Mutation-checked: each invariant test fails when its rule is broken locally.
- **Shared db mock:** `tests/fixtures/db.ts` (`dbModule`) mirrors the full export surface of `src/db`; all `mock.module("../src/db")` calls use it. Fixes an order-dependent failure (`Export named 'existingMessageIds' not found`) that `lookup + rss` already had.

- **Phase 4 harness:** `scripts/lib/test-postgres.ts`, `scripts/check-db-tests.ts` (the `db tests` step, also `bun run test:db`), `tests-db/fixtures/database.ts` (`useTestDatabase()`) and `tests-db/harness.test.ts` (a clone has all 39 tables, clones are isolated, a CHECK constraint rejects a bad row). The step takes about 2.3 s. Lessons: a Bun SQL query is a lazy thenable, so `expect(query).rejects` hangs (await it inside an async function first); `src/db` reads `DATABASE_URL` once at import, so the runner runs each `tests-db` file in its own `bun test` process in parallel (a shared process kept later files on the first file's dropped database); a 60 s per-file watchdog kills a hung file, and the runner kills its children on SIGINT/SIGTERM.
- **Phase 4 stores, all four committed, each mutation-checked, no store bugs found:** `tests-db/notes-store.test.ts` (24 tests: history on every mutation, soft delete, Keep seeding, trash purge), `questions-store.test.ts` (19: status transitions, events, chat cap, contact learning with only the model call mocked), `actions-store.test.ts` (13: the double-tap claim, stale claims, re-run replaces only unresolved rows; mocks `executeSkill` and the zone lookup), `news-store.test.ts` (13: whole-or-nothing desk persist, reuse of stored desks, what the reader was told, priorities). The `db tests` step runs 69 tests in about 2.5 s.

### Bugs found and fixed on the way (committed)

1. `src/skills/execute.ts`: the critical-skill rejection settled the audit row without a reason; it now goes through `reject()` like the other rejections.
2. `dashboard/src/lib/offline/outbox.ts` `queue()`: the optimistic effect was applied before the intent was stored, so a snapshot pull landing in between overwrote it and `reapplyPending` could not re-assert it (a restored note snapped back into the trash). Now the intent is stored first. Regression test in `dashboard/tests/offline-outbox.test.ts`.
3. `dashboard/src/lib/offline/intents.ts`: `report.read` apply and `patchReportsRating` did get-then-put of the whole report row, so a rating and a read receipt could overwrite each other. Both use `db.update` now. Regression test in `dashboard/tests/offline-intents.test.ts`.
4. Blackhole harness (`dashboard/scripts/blackhole/proxy.ts`, `verify.ts`, `steps.ts`, `lane.ts`): the new `report.read` write was unknown to the harness (forwarded to a database-less server, so the lane never reached "Synced" and crashed). One shared exported `WRITE` regex now covers it, `EXPECTED_WRITES` lists the two receipts, and the first-launch step scrolls to the end of today's report and waits for its receipt so it no longer depends on timing.
5. `dashboard/src/routes/notes` and `entities` `+page.svelte`: the pages read `page.url`, but a written filter lives in `page.shallow.url`, so a mirror reload (which hands `page.url` over again) read as an external navigation and reset the filter. This was the `/notes: restore a note from the trash` flake (3 of 5 full runs). Now `shownUrl()` reads `page.shallow?.url ?? page.url`. Pinned by `dashboard/scripts/blackhole/race.ts`, which forces the race in about 7 s and is part of the blackhole suite.
6. `src/util/time.ts`: `isLocalDate("2026-02-31")` was true (JavaScriptCore rolls it to March 3) and `zonedToIso` accepted `02-30` or `25:00` the same way, so a model-proposed quick action could be offered for the wrong day. Both now require a round trip. Tests in `tests/time.test.ts`.
7. `src/pipeline/phase6/system-block.ts`: claimed invalid SYSTEM-block entries were skipped but a new topic without headline/domain, a new entity without a name, or a non-list field aborted the block (and Section 2 after it); a JSON block that was not an object was accepted. Now every list goes through `records()` and bad entries are skipped. Tests in `tests-db/system-block.test.ts`.
8. `src/ingest/imap.ts` and `unsubscribe.ts`: both read `parsed.headers.get("list-unsubscribe")` / `"list-id"`, but mailparser folds every `List-*` header into one `list` entry, so those were always undefined. A new newsletter was never recognised by its list headers (only `Precedence` worked) and the unsubscribe lookup always skipped its header step and went to the body scan and the model. Both now read through `listHeaders()` in `sources.ts`. Tests in `tests/classify-email.test.ts` (real parse), `tests-db/ingest-unsubscribe.test.ts` and `tests-db/ingest-imap.test.ts`.

### Open

- **Blackhole under load:** with the machine busy (load average above 8) a `navigate while believed online` step can miss its 4000 ms budget by a few ms. Not a code defect; rerun when the machine is quiet.
- **Commits:** everything above is committed and the temporary worktrees are gone. The standing rule stays: no test-work commit without a passing full `bun run check`. Do not stage other sessions' files.
- **Then, in this order:**
  1. Phase 3, what is left: the Phase 5 half of 3.4 (`phase5-synthesis.ts` payload builders, `phase4-questiongate.ts` candidate selection). Done: 3.5 `tests-db/news-research.test.ts` and `news-run.test.ts` (28 tests through `runNewsDesk`, with the model and the Brave client stubbed in `tests-db/fixtures/news-desks.ts`; the desk is told apart by what its payload contains; mutation-checked; no bug found), 3.1 `tests/actions-matching.test.ts`, 3.2 `tests/actions-check.test.ts`, 3.3 `tests/question-plan.test.ts` (the pure logic was split into `src/questions/plan.ts`) plus `tests-db/reconcile-queue.test.ts`, 3.4 SYSTEM block, 3.6 `tests-db/ingest-google.test.ts`, `ingest-imap.test.ts` and `ingest-unsubscribe.test.ts` (fake IMAP connection and a `googleapis` stub with a tasks client in `tests/fixtures/googleapis.ts`; mail is parsed for real), 3.7 `tests/surfaces.test.ts`. Lesson: partial `mock.module` mocks of `ai/openai` and `ai/active-prompts` in one root test leak into later files that import the real ones, so a module that imports them is easiest to test by splitting its pure logic out.
  2. Phase 4 leftovers worth a `tests-db` file: schema constraints rejecting bad rows (`user_settings_content_language_code`, `contacts_identifier_email_like`), the Brave quota upsert (`lt(calls, 30)`) against real SQL, `apply-plan.ts` (the pipeline's guarded `status = 'open'` writes), and `context-builder/output/db-writer.ts` idempotence (Phase 5.1).
  3. Phase 5: context-builder tests and the dashboard server-route tests (69 files).
  Each store test file can reuse the pattern in `tests-db/*-store.test.ts`: `useTestDatabase()` first, dynamic imports after, `truncate` in `beforeEach`, `mock.module` only for the model, network and skill gate.

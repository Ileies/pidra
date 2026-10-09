# Operations

## Deployment

**`bun run deploy` is how pronix gets new code. Never assemble the steps by hand.** A deploy is a pull plus the three things a pull cannot carry: the gitignored config and harvest files, the dependency install, and the dashboard build. Doing it manually is how `dashboard/build/` ends up a version behind its source with nothing looking broken. `scripts/deploy.ts` also verifies more than systemd does: it follows `/` past its redirect and requests `/context-builder`, because a broken page still leaves a unit reporting `active`.

Flags:

- `--dry-run`: print every step without touching the server
- `--push`: push the branch instead of refusing
- `--skip-check`: skip `bun run check` entirely
- `--quick-check`: run `bun run check --quick` instead of the full check (an explicit trade of coverage for speed, never the default)
- `--force`: deploy past an uncommitted working tree. It still deploys the last *commit*, never the uncommitted edits, so it only acknowledges that gap
- `--host <alias>`: target something other than `ros`

It refuses rather than improvises: an uncommitted tree (unless `--force`), commits not on origin (the server pulls from a *public* repo, so a deploy publishes them), a local branch behind origin, a dirty tree on the server, or a failing check in either the root or `dashboard/`.

**One Bun workspace.** The root `package.json` declares `"workspaces": ["dashboard"]`, so there is one `bun.lock` (at the root, none in `dashboard/`) and one `bun install`; the deploy runs a single `bun install --frozen-lockfile` at the root, then the dashboard build. Dashboard packages still land in `dashboard/node_modules`. The dashboard runs stable `@sveltejs/kit` 3.0.0 and `@sveltejs/adapter-node` 6.0.0 (caret ranges, the earlier exact pins to next versions are gone). One upstream workaround lives in `dashboard/vite.config.ts`: kit 3.0.0's `builder.mimeTypes` learns extensions only from prerendered paths (`/privacy`, no extension) and the client dir, never from the prerendered `.html` files, so adapter-node served `/privacy` and `/terms` with no content-type header and browsers downloaded them instead of rendering. `withHtmlMime()` wraps the adapter in a Proxy that seeds `{".html": "text/html"}` into `builder.mimeTypes`. Remove it once a kit release fixes this. TypeScript is split on purpose: the dashboard stays on ^6 because `svelte-kit sync` crashes under TS 7 (no `ts.sys`), while the root is on ^7.

**Not carried by a deploy:**

- **`.env`**, on either machine. Both files hold the same keys with different values (the server reaches Postgres locally, the workstation through a forward), so a copy in either direction breaks the other. The same goes for `context-builder/.checkpoint.json` and `errors.json`: the server runs its own monthly harvest and those are its live state. A new key means editing both `.env` files by hand.
- **The systemd units.** They live in `hosts/pronix/pidra.nix` in the nixos flake, so a change to a unit, a timer or the firewall needs `nixos-rebuild` **on pronix**. A deploy that should have been a rebuild fails silently: the code lands and the unit keeps its old definition.
- **The nginx headers.** `/service-worker.js` must be served with `Cache-Control: no-cache`, or a proxy-cached worker pins every installed phone to an old build. The rule is in `hosts/pronix/nginx.nix`; like the units, a change is a `nixos-rebuild` on pronix.

## The check

`bun run check` runs the root checks (`tsc`, `check-skill-writes.ts`, `check-route-surfaces.ts`, `check-openai-rules.ts` as the `openai-rules` step, `check-file-size.ts` as the `file-size` step, the root tests as the `unit tests` step, and the `tests-db/` suite as the `db tests` step) and the dashboard's check concurrently. Both `scripts/check.ts` and `dashboard/scripts/check.ts` share one runner, `scripts/lib/check-runner.ts` (buffering, `--quick`/`--verbose` parsing, warning detection).

The `openai-rules` step is a static guard for the OpenAI API rules in `CLAUDE.md`. It fails when anything outside `src/ai/openai.ts` constructs an OpenAI client, imports the `openai` package at runtime or calls the Responses, Chat or audio endpoints directly; when OpenAI's hosted `web_search` tool appears anywhere; when `openai.ts` sends `temperature`, `max_tokens` or `max_completion_tokens`; or when `store: false` or `service_tier: "flex"` disappears from `openai.ts`.

Root tests that mock `src/db` use `dbModule` from `tests/fixtures/db.ts`: Bun fixes a module's export names at its first `mock.module`, so every mock of `src/db` must offer all its exports.

The `db tests` step (`bun run test:db`, `scripts/check-db-tests.ts`) runs `tests-db/**/*.test.ts` against a throwaway local Postgres, because the stores' behavior is mostly SQL and mocks prove little. Each file gets its own `bun test` process, run in parallel: `src/db` reads `DATABASE_URL` once at import, so a shared process would keep every later file on the first file's (already dropped) database, and `mock.module` overrides would leak between files. Success prints one line (`db tests: N pass, 0 fail across M files`); a failing file's full output is printed. A file still running after 60 s (`FILE_TIMEOUT_MS`) is killed and reported: its output ends with `(killed: <file> had not finished after 60 s)`, so a hung test fails the step instead of wedging `bun run check`. `bun run test:db <path>.test.ts` runs a single file, and other arguments (such as a `-t` filter) go to `bun test`. `scripts/lib/test-postgres.ts` starts an instance (`initdb --no-sync`, `pg_ctl`, `fsync=off`) on a random loopback port with a short socket dir, loads the schema from `drizzle-kit export` into a template database `tpl` (then applies `src/db/search-columns.sql`, the generated search columns that are in no schema file; see `docs/schema-notes.md`), and sweeps stale dirs of killed runs. It needs Postgres binaries: `initdb`/`pg_ctl` on PATH, or nix (`nix build nixpkgs#postgresql_17`); with neither it fails loudly. The runner sets `PIDRA_TEST_DATABASE_URL` and a local `DATABASE_URL` safety net so the production URL in `.env` is never reachable, and tears the instance down on exit, SIGINT and SIGTERM (on a signal it first SIGKILLs the per-file `bun test` children, then stops Postgres). The instance runs with `max_connections=400` because a Bun SQL pool opens up to 10 connections eagerly and each file holds 3 pools; the fixture caps its own pools at 1 (admin) and 2. A test file calls `useTestDatabase()` (`tests-db/fixtures/database.ts`), which clones a `t_<random>` database from `tpl`, points `DATABASE_URL` at it before `src/db` is imported and drops it in `afterAll`. `assertThrowawayUrl` is a hard rule: loopback or socket only, and a database name `t_*`, `*_test`, `tpl` or `postgres`. A Bun SQL query is a lazy thenable, so `expect(query).rejects` hangs: await it inside an async function.

`tests-db/` also covers the bridge and the dashboard server routes (login, the `hooks.server.ts` gate, the JSON endpoints, the offline snapshot, the page form actions). Dashboard modules are imported straight into `bun test` with `$app/env` and `$app/env/private` stubbed by `tests-db/fixtures/dashboard.ts`: call `setPrivateEnv()` after `useTestDatabase()`, and use the fixture's `RequestEvent` and cookie jar. Bridge calls from the dashboard go through a stubbed `fetch`. The Hono bridge routes are driven with `server.fetch` (`tests-db/fixtures/bridge.ts`), with the model turn, pipeline run, TTS and skill gate stubbed.

The `file-size` step fails a tracked `.ts` file over 350 lines or a `.svelte` file over 250. The `EXCEPTIONS` table in `scripts/check-file-size.ts` gives a justified file its own ceiling at its current size (the blackhole `fixture.ts`, `src/notes/store.ts`, `runTrace.ts`, and the `[date]` and `runs/[id]` pages); it also fails when an excepted file no longer exists. Lower or delete an entry when the file shrinks, and prefer splitting a file to adding one. The dashboard side ends with the offline blackhole suite, which dominates wall time (~65-70 s against well under 4 s for everything else).

Output is kept short to save tokens: each step is buffered and a passing one prints a single `ok <step> (<secs>s): <last output line>`. A failing step prints its full stdout/stderr under `=== <step> failed ===`, and a passing step that reports warnings (a nonzero count or a `Warn:` line) still prints its full output under `--- <step> warnings ---`, so warnings are never silenced. The run ends with `dashboard: all steps pass` and `check: root and dashboard both pass.`. `bun run check --verbose` (`-v`, forwarded to the dashboard check, combinable with `--quick`) disables buffering so every step streams its full output live.

`bun run check --quick` (`-q`, or `bun run check:quick` in either `package.json`) skips only that suite; the root `unit tests` step (`bun test ./tests`, ~0.4 s) and the `db tests` step (~2.5 s) still run. The root `test` script is the same `bun test ./tests` - a bare `bun test` also discovers `dashboard/tests`, which need `--conditions=browser` and fail without it. Use it while iterating on a change that cannot touch routing, offline behavior or rendering. The `commit` skill and a plain `bun run deploy` both require the full run.

## DB access and schema changes

`DATABASE_URL` points at `192.168.10.85`, reachable on the LAN only. From outside, tunnel first with `ssh -N -L 15432:127.0.0.1:5432 ros` and point `DATABASE_URL` at `127.0.0.1:15432`.

There is no `migrations/` directory: the owner has one database and every past change is already applied to it. The Drizzle schema under `src/db/schema/` is the source of truth. `drizzle-kit migrate` hangs in this environment, so **apply schema changes raw** with a temporary Bun script using `new SQL(DATABASE_URL)`, then delete the script. The ORM uses RQB v2: `src/db/relations.ts` exports a single `defineRelations(schema, ...)` result that `drizzle()` takes as `relations`.

**Apply a schema change before deploying code that reads it.** Code that reads a new table or column fails at run time, not at build time, so a deploy cannot catch the gap.

**Destructive changes run the other way: deploy the code first, then drop.** Even when no code reads a column any more, Drizzle's `db.select().from(table)` and `.returning()` list every schema column by name, so the code already running on pronix still selects it and its queries fail as soon as the column is gone.

## Cron schedule (all `Europe/Berlin`)

| Job | Schedule |
|---|---|
| `pipeline` | daily 06:30 (the timer is what schedules it; implicit feedback takes the run's start from the earliest `pipeline_runs.started_at` for the run date, falling back to midnight UTC) |
| `feedback` (implicit feedback) | daily 22:00 |
| `prune` (entity graph pruning, trashed-note purge) | Sunday 02:00 |
| `review` (weekly review conversation) | Sunday 20:00 |
| `source-scoring` | Sunday 23:00 |
| `meta-run` (analytics and prompt diff) | Sunday 23:30 |
| `context-builder` (update run) | 1st of the month, 03:00 |

Each is a `pidra-<job>` systemd timer on pronix, defined in `hosts/pronix/pidra.nix`, running `bun run src/job.ts <job>`. A timer is `Persistent`, so a run missed while the box was off happens on boot. Adding a scheduled job means one entry in `JOBS` (`src/job.ts`), one in `jobs` (`pidra.nix`) and a row here and in `README.md`.

## Concurrency

- **Phase 2 (extraction):** `CONCURRENCY = 4` workers in `phase2-extract.ts`. It is an API concurrency limit: raising it trades rate-limit risk against wall-clock, not VRAM.
- **Phase 3 (context assembly and web search):** runs in parallel with Phase 2.
- **News desks:** every enabled desk in parallel, started before Phase 1 and awaited before Phase 3, so their half a minute to five minutes on the flex tier overlaps the ingest. The editor runs alongside Section 1 in Phase 5; if it fails, `renderNewsFallback` writes the section from the stories directly. Tune without a pipeline run: `bun run scripts/news-dry-run.ts [--editor]` (real calls, nothing stored).
- **Quick actions:** one call, run alongside Section 1 once Phase 3 is done. A failure costs the buttons and nothing else; its attempts go to `step_errors` under `phase5-actions`.
- **Question gate (Phase 4):** nothing waits on it. It reconciles this run's candidates into the queue in one call alongside Section 1, leaves them open on `/questions`, and hands Section 2 `recentAnswers()` (item answers of the last `ANSWER_DAYS = 7` days). Answers given later are used from the next run on, and are also acted on at once: `POST /api/questions/:id/answer` starts `processAnswer` without awaiting it, since the tool-calling turn can take a minute. A bridge that dies mid-turn leaves `answer_status = 'running'`, and `/questions/closed` offers "Run again" (the `reprocess` op, refused with 409 once the answer is `done` or while it is `running` and `updated_at` is within 15 minutes; older `running` rows stay reprocessable, since reprocess is the recovery path for a dead bridge). `POST /api/pipeline/run` likewise returns 409 while a `pipeline_runs` row is `running` (rows older than 3 hours count as stale), so a double click cannot double the spend. `daily_reports.question_gate_fired` means "this run's candidates landed on at least one open question".

## Spoken report

The report page's Play button speaks a chapter on its first request and caches it in `report_audio` (table already applied). Optional env: `OPENAI_MODEL_TTS` (default `gpt-4o-mini-tts`) and `OPENAI_TTS_VOICE` (default `cedar`). Changing the model or voice speaks the day again, since the cache key includes `model:voice`. A long chapter's text chunks are spoken 3 at a time (`SPEAK_CONCURRENCY`) to cut first-play latency.

- **Cost**, measured for 2026-10-02: the spoken text is 1,611 tokens, 7,777 characters and about 9 minutes of audio (the raw markdown is 4,405 tokens, mostly refs UUIDs). A fully played report costs about $0.001 in input and $0.13 in audio output (`gpt-4o-mini-tts`, about $0.015 per minute), and each chapter is paid once. The speech endpoint returns no usage, so `src/audio/cost.ts` estimates it (input chars/4.8 tokens at $0.60 per 1M, output $0.015 per minute of MP3) and `store.ts` adds it to `pipeline_runs.audio_cost_usd` of the date's newest run, only for the request that actually inserted the chapter row.
- **Size:** the output is MPEG-2 Layer 3, 128 kbit/s CBR, 24 kHz, about 14 characters of text per second of speech, so about 9.6 MB per fully cached report in Postgres. Rows older than 30 days are deleted whenever a chapter is generated, except the day just spoken. There is no job for it.
- **Failure:** a speech failure after the 429/5xx retry is a 502 to the player; nothing is cached, so the next tap tries again.

## Step timing

Step timing shows where a run spends its time: a news desk, a flex backoff, a synthesis retry. It is read at `/runs/[id]` (see `docs/dashboard.md`).

`src/util/trace.ts` is an `AsyncLocalStorage` span tracer writing `pipeline_run_steps`. `traceRun` opens the root span in `run.ts` and `span(step, fn)` nests under the current one; outside a run both are a plain call, so weekly jobs sharing `withRetry` and the OpenAI client pay nothing. Spans sit in `run.ts`, Phases 1-4 and one per news desk, and every `withRetry` attempt is a span named by its step with its attempt number.

- Model calls (`src/ai/openai.ts`), Brave searches (`src/search/brave.ts`) and flex backoffs report to the current span via `recordUsage` / `recordAiCall` / `recordSearch` / `recordFlexRetry`. Counters are a span's own values and the dashboard sums descendants, so a parent never double-counts.
- Every trace write is swallowed: a failed insert costs a bar, never a briefing.
- Runs before 2026-10-01 have no step data. Those before the question gate stopped waiting also show a `phase4-wait` span of up to 45 minutes (`detail`: `questions`, `unanswered`, `outcome`, `timeoutMinutes`); new runs never write it.

## Jev shadow mode

Two independent shadow tasks, each switched by its own env var (`shadow` turns it on; unset or any other value is off; both are `shadow` in pronix's `.env` since 2026-10-07, first `jev_decisions` rows expected from the next run): `JEV_MODE_NEWS_IMPACT` for `news_impact` and `JEV_MODE_NEWS_NOVELTY` for `news_novelty`. After the news desks' deterministic checks and duplicate marking, `shadowNewsJev(candidates, reported, transport?)` (`src/news/jev-shadow.ts`, in a `news:jev-shadow` span) runs both over each story that passed the checks and was not stored by an earlier run. Rubrics come from the approved-prompt resolver: `jev_news_impact` and `jev_news_novelty` (four ordered levels: nothing new, minor update, material development, entirely new).

- `news_impact` sends only public story fields (headline, summary, context, region, topic, happened_at).
- `news_novelty` sends the same fields plus `prior_headlines`: the newest 20 already-reported desk headlines with dates (`PRIOR_HEADLINE_LIMIT`), taken from the desks' `reported` input. These are reader-delivered public news headlines, never notes or personal context.
- One `jev_decisions` row per story per task. A failure in one task is warned and does not affect the other.

It never throws, needs a traced run id (`currentRunId()` in `src/util/trace.ts`, so dry runs and scripts record nothing), and nothing it produces reaches stories, the gate or the report.

## Synthesis output parsing

Both synthesis calls append a machine-readable `<!--SYSTEM ... -->` JSON block at the end of their output. Phase 6 parses it to drive all memory writes (new topics, entity upserts, contact updates, skill suggestions). Do not add a separate model call for Phase 6 logic. The block is model output, so parsing is defensive: a block that is not a JSON object is treated as absent, list fields that are not lists and entries that are not objects are dropped, and an entry missing its required text (a new topic's headline or domain, a new entity's name, a skill suggestion's skill) is skipped. Invalid entries never fail the step or the rest of the block.

## Error handling model

Every pipeline step is wrapped in `withRetry` (`src/pipeline/withRetry.ts`):

- Up to **3 attempts** per step, with a 2 s delay after attempt 1 and 5 s after attempt 2.
- Each failed attempt is recorded as a `StepAttemptError` (`{step, attempt, error, stack, ts}`). When all fail, a `StepError` is thrown carrying the log.
- `run.ts` catches `StepError` and writes the outcome to `pipeline_runs`: `status`, `failed_step`, `step_errors` (JSONB array), `duration_ms`. The dashboard renders it as an error card with each attempt's message and timestamp and an expandable stack trace.

- Steps the run can do without (quick actions, news editor, news repeat judge (fails open on its own), review absorb, question reconcile) use `tolerant(step, fn, fallback, errors, message)` from the same file: retries as above, but on exhaustion the attempts are pushed to `step_errors`, `message` is logged and `fallback()` stands in, so the run continues.
- `withRetry`, `withFlexRetry` (`src/ai/openai.ts`) and the Brave request loop (`src/search/brave.ts`) are thin callers of the one generic `retry()` in `src/util/retry.ts`; add no new hand-written retry loops.

When adding a pipeline phase, always call it as `withRetry("phaseN", () => runPhaseN(...))`, never directly in `run.ts`.

IMAP ingest reads from the last completed run's `started_at` (earlier `run_date`), floored at `IMAP_LOOKBACK_DAYS` (default 1) and capped at 3 days (`src/ingest/imap-window.ts`, computed once per run in Phase 1), so a delayed or skipped run does not lose mail from the gap; `message_id` dedup makes the overlap safe.

RSS ingest looks back 14 days by default (`RSS_LOOKBACK_DAYS`) so midnight-dated weekly items and short outages are not missed; message IDs deduplicate: RSS (per feed) and IMAP (per batch of 8 parsed mails) check existing ids with one query and bulk insert, and the insert skips a conflicting `raw_items.message_id` instead of failing, since feeds and mail accounts run in parallel and can carry the same id. Each feed fetch records its latest error or success on the feed row, and failures also enter the run error log shown on `/runs`.

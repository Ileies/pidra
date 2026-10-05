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

`bun run check` runs the root checks (`tsc`, `check-skill-writes.ts`, `check-route-surfaces.ts`, `check-file-size.ts` as the `file-size` step, and the root tests as the `unit tests` step) and the dashboard's check concurrently. Both `scripts/check.ts` and `dashboard/scripts/check.ts` share one runner, `scripts/lib/check-runner.ts` (buffering, `--quick`/`--verbose` parsing, warning detection).

The `file-size` step fails a tracked `.ts` file over 350 lines or a `.svelte` file over 250. The `EXCEPTIONS` table in `scripts/check-file-size.ts` gives a justified file its own ceiling at its current size (the blackhole `fixture.ts`, `src/notes/store.ts`, `runTrace.ts`, and the `[date]` and `runs/[id]` pages); it also fails when an excepted file no longer exists. Lower or delete an entry when the file shrinks, and prefer splitting a file to adding one. The dashboard side ends with the offline blackhole suite, which dominates wall time (~65-70 s against well under 4 s for everything else).

Output is kept short to save tokens: each step is buffered and a passing one prints a single `ok <step> (<secs>s): <last output line>`. A failing step prints its full stdout/stderr under `=== <step> failed ===`, and a passing step that reports warnings (a nonzero count or a `Warn:` line) still prints its full output under `--- <step> warnings ---`, so warnings are never silenced. The run ends with `dashboard: all steps pass` and `check: root and dashboard both pass.`. `bun run check --verbose` (`-v`, forwarded to the dashboard check, combinable with `--quick`) disables buffering so every step streams its full output live.

`bun run check --quick` (`-q`, or `bun run check:quick` in either `package.json`) skips only that suite; the root `unit tests` step (`bun test ./tests`, ~0.4 s) still runs. The root `test` script is the same `bun test ./tests` - a bare `bun test` also discovers `dashboard/tests`, which need `--conditions=browser` and fail without it. Use it while iterating on a change that cannot touch routing, offline behavior or rendering. The `commit` skill and a plain `bun run deploy` both require the full run.

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
- **Question gate (Phase 4):** nothing waits on it. It reconciles this run's candidates into the queue in one call alongside Section 1, leaves them open on `/questions`, and hands Section 2 `recentAnswers()` (item answers of the last `ANSWER_DAYS = 7` days). Answers given later are used from the next run on, and are also acted on at once: `POST /api/questions/:id/answer` starts `processAnswer` without awaiting it, since the tool-calling turn can take a minute. A bridge that dies mid-turn leaves `answer_status = 'running'`, and `/questions/closed` offers "Run again" (the `reprocess` op, refused once the answer is `done`). `daily_reports.question_gate_fired` means "this run's candidates landed on at least one open question".

## Spoken report

The report page's Play button speaks a chapter on its first request and caches it in `report_audio` (table already applied). Optional env: `OPENAI_MODEL_TTS` (default `gpt-4o-mini-tts`) and `OPENAI_TTS_VOICE` (default `cedar`). Changing the model or voice speaks the day again, since the cache key includes `model:voice`. A long chapter's text chunks are spoken 3 at a time (`SPEAK_CONCURRENCY`) to cut first-play latency.

- **Cost**, measured for 2026-10-02: the spoken text is 1,611 tokens, 7,777 characters and about 9 minutes of audio (the raw markdown is 4,405 tokens, mostly refs UUIDs). A fully played report costs about $0.001 in input and $0.13 in audio output (`gpt-4o-mini-tts`, about $0.015 per minute), and each chapter is paid once.
- **Size:** the output is MPEG-2 Layer 3, 128 kbit/s CBR, 24 kHz, about 14 characters of text per second of speech, so about 9.6 MB per fully cached report in Postgres. Rows older than 30 days are deleted whenever a chapter is generated, except the day just spoken. There is no job for it.
- **Failure:** a speech failure after the 429/5xx retry is a 502 to the player; nothing is cached, so the next tap tries again.

## Step timing

Step timing shows where a run spends its time: a news desk, a flex backoff, a synthesis retry. It is read at `/runs/[id]` (see `docs/dashboard.md`).

`src/util/trace.ts` is an `AsyncLocalStorage` span tracer writing `pipeline_run_steps`. `traceRun` opens the root span in `run.ts` and `span(step, fn)` nests under the current one; outside a run both are a plain call, so weekly jobs sharing `withRetry` and the OpenAI client pay nothing. Spans sit in `run.ts`, Phases 1-4 and one per news desk, and every `withRetry` attempt is a span named by its step with its attempt number.

- Model calls (`src/ai/openai.ts`), Brave searches (`src/search/brave.ts`) and flex backoffs report to the current span via `recordUsage` / `recordAiCall` / `recordSearch` / `recordFlexRetry`. Counters are a span's own values and the dashboard sums descendants, so a parent never double-counts.
- Every trace write is swallowed: a failed insert costs a bar, never a briefing.
- Runs before 2026-10-01 have no step data. Those before the question gate stopped waiting also show a `phase4-wait` span of up to 45 minutes (`detail`: `questions`, `unanswered`, `outcome`, `timeoutMinutes`); new runs never write it.

## Synthesis output parsing

Both synthesis calls append a machine-readable `<!--SYSTEM ... -->` JSON block at the end of their output. Phase 6 parses it to drive all memory writes (new topics, entity upserts, contact updates, skill suggestions). Do not add a separate model call for Phase 6 logic.

## Error handling model

Every pipeline step is wrapped in `withRetry` (`src/pipeline/withRetry.ts`):

- Up to **3 attempts** per step, with a 2 s delay after attempt 1 and 5 s after attempt 2.
- Each failed attempt is recorded as a `StepAttemptError` (`{step, attempt, error, stack, ts}`). When all fail, a `StepError` is thrown carrying the log.
- `run.ts` catches `StepError` and writes the outcome to `pipeline_runs`: `status`, `failed_step`, `step_errors` (JSONB array), `duration_ms`. The dashboard renders it as an error card with each attempt's message and timestamp and an expandable stack trace.

- Steps the run can do without (quick actions, news editor, review absorb, question reconcile) use `tolerant(step, fn, fallback, errors, message)` from the same file: retries as above, but on exhaustion the attempts are pushed to `step_errors`, `message` is logged and `fallback()` stands in, so the run continues.
- `withRetry`, `withFlexRetry` (`src/ai/openai.ts`) and the Brave request loop (`src/search/brave.ts`) are thin callers of the one generic `retry()` in `src/util/retry.ts`; add no new hand-written retry loops.

When adding a pipeline phase, always call it as `withRetry("phaseN", () => runPhaseN(...))`, never directly in `run.ts`.

RSS ingest looks back 14 days by default (`RSS_LOOKBACK_DAYS`) so midnight-dated weekly items and short outages are not missed; message IDs deduplicate: RSS (per feed) and IMAP (per batch of 8 parsed mails) check existing ids with one query and bulk insert, and the insert skips a conflicting `raw_items.message_id` instead of failing, since feeds and mail accounts run in parallel and can carry the same id. Each feed fetch records its latest error or success on the feed row, and failures also enter the run error log shown on `/runs`.

# Operations

## Deployment

**`bun run deploy` is how pronix gets new code. Never assemble the steps by hand.** A deploy is a pull plus the three things a pull cannot carry - the gitignored config and harvest files, the dependency install, and the dashboard build - and doing it manually is how `dashboard/build/` ends up a version behind its source, silently, because nothing about a stale build looks broken. `scripts/deploy.ts` also verifies more than systemd does: it follows `/` past its redirect and requests `/context-builder`, because a broken page still leaves a unit reporting `active`.

Flags: `--dry-run` prints every step without touching the server, `--push` pushes the branch instead of refusing, `--skip-check` skips `bun run check`, `--host <alias>` targets something other than `ros`.

It refuses rather than improvises: an uncommitted tree, commits not on origin (the server pulls from a *public* repo, so a deploy publishes them), a local branch behind origin, a dirty tree on the server, or a failing check in either the root or `dashboard/`.

Two things it deliberately does not carry:

- **`.env`**, on either machine. Both files hold the same keys with different values - the server reaches Postgres locally, the workstation through a forward - so a copy in either direction breaks the other. Same for `context-builder/.checkpoint.json` and `errors.json`: the server runs its own monthly harvest and those are its live state, not a stale mirror. A new key means editing both `.env` files by hand.
- **The systemd units.** They live in `hosts/pronix/pidra.nix` in the nixos flake, so a change to a unit, a timer, or the firewall needs `nixos-rebuild` **on pronix** and is not part of a deploy at all. A deploy that should have been a rebuild fails silently: the code lands and the unit keeps its old definition.
- **The nginx headers.** `/service-worker.js` must be served with `Cache-Control: no-cache`, or a proxy-cached worker pins every installed phone to an old build. The rule is in `hosts/pronix/nginx.nix` (live since 2026-09-25); like the units, a change there is a `nixos-rebuild` on pronix.

## DB access and migrations

`DATABASE_URL` points at `192.168.10.85`, which is reachable on the LAN only. To run from outside, tunnel first with `ssh -N -L 15432:127.0.0.1:5432 ros`, then point `DATABASE_URL` at `127.0.0.1:15432`.

`drizzle-kit migrate` hangs in this environment. **Always apply schema changes manually** via a temporary Bun script using `new SQL(DATABASE_URL)`. After applying, delete the temp script. The `migrations/` folder and DrizzleORM schema stay in sync for reference, but the actual migration is applied raw.

`migrations/0027_newsletter_sources.sql` creates and seeds the live sender rules and RSS feeds. Apply it before deploying code that reads those tables. Each RSS feed fetch records its latest error or success on the feed row; failures also enter the run error log and Notifications. RSS uses a 14-day lookback by default (`RSS_LOOKBACK_DAYS`) so midnight-dated weekly items and short outages do not get missed; message IDs deduplicate them.

## Cron schedule (all `Europe/Berlin`)

- Daily pipeline: configurable via `PIPELINE_RUN_TIME` env var (default 06:30)
- Implicit feedback: 22:00 daily
- Weekly source quality scoring: Sunday 23:00
- Weekly review conversation: Sunday 20:00
- Weekly meta-run (analytics + prompt diff): Sunday 23:30
- Entity graph pruning: Sunday 02:00
- Context Builder update run: 1st of the month, 03:00

Every one of these is a `pidra-<job>` systemd timer on pronix, defined in `hosts/pronix/pidra.nix` in the nixos flake, and runs `bun run src/job.ts <job>`. Adding a scheduled job means one entry in `JOBS` (`src/job.ts`) and one in `jobs` (`pidra.nix`), plus a line here.

## Concurrency

Phase 2 (extraction): `CONCURRENCY = 4` workers in `phase2-extract.ts`. It is an API concurrency limit: raising it trades rate-limit risk against wall-clock, not VRAM.

Phase 3 (context assembly + web search): runs in parallel with Phase 2.

News desks: every enabled desk in parallel, started before Phase 1 and awaited before Phase 3, so their half a minute to five minutes on the flex tier overlaps the ingest instead of following it. The editor runs alongside Section 1 in Phase 5; if it fails, `renderNewsFallback` writes the section from the stories directly. Tuning without a pipeline run: `bun run scripts/news-dry-run.ts [--editor]` (real calls, nothing stored).

Quick actions: one call, run alongside Section 1 once Phase 3 is done. A failure costs the buttons and nothing else; its attempts go to `step_errors` under `phase5-actions`.

Section 1 synthesis never waits for the question gate. Section 2 blocks for up to 45 minutes, and only on the questions this run's mail landed on; the reconcile call runs alongside Section 1.

## Synthesis output parsing

Both synthesis calls append a machine-readable `<!--SYSTEM ... -->` JSON block at the end of their output. Phase 6 parses this block to drive all memory writes (new topics, entity upserts, contact updates, skill suggestions). Do not add a separate model call for Phase 6 logic.

## Error handling model

Every pipeline step is wrapped in `withRetry` (`src/pipeline/withRetry.ts`). Rules:

- Each step is retried up to **3 times** on failure (delays: 2 s after attempt 1, 5 s after attempt 2).
- Each failed attempt is recorded as a `StepAttemptError` with `{step, attempt, error, stack, ts}`.
- When all 3 attempts fail, a `StepError` is thrown with the full attempt log.
- `run.ts` catches `StepError` and writes the run outcome to the `pipeline_runs` table: `status`, `failed_step`, `step_errors` (JSONB array), `duration_ms`.
- The dashboard reads `pipeline_runs` and renders a detailed error card showing which step failed, each attempt's error message and timestamp, and an expandable stack trace.

When adding a new pipeline phase, always wrap the call with `withRetry("phaseN", () => runPhaseN(...))` - never call phase functions directly in `run.ts`.

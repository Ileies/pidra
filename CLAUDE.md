# CLAUDE.md — PIDRA

## What this project is

PIDRA consists of three tools that share one Postgres database:

1. **Daily pipeline** (`src/` + `run.ts`) — morning briefing system. Ingests 32 newsletters, personal emails, SMS, Google Calendar, and Google Tasks via RSS, IMAP, and APIs. Two Ollama passes compress raw content into structured JSON; one Sonnet call synthesizes each section of the report. Compounds over time through an entity knowledge graph, source trust scoring, and weekly self-improvement runs.

2. **Dashboard** (`dashboard/`) — SvelteKit frontend for reading reports, rating items, viewing the entity graph, managing notes, reviewing skill executions, and approving prompt changes.

3. **Context Builder** (`context-builder/`) — standalone one-shot tool that performs a comprehensive scan of all personal data sources (all email accounts, Google Keep, Google Tasks, GitHub) and builds a structured long-term context document. Seeds the `entities`, `contacts`, and `standing_context` tables before the first pipeline run — so the system is calibrated from day one instead of learning from scratch. Re-runnable in update mode (delta only, proportional merge). Full plan in `CONTEXT_BUILDER_PLAN.md`.

Full daily pipeline architecture is in `MORNING_BRIEFING_PLAN.md`. All decisions and rationale are in `CONTEXT_AND_DECISIONS.md`. Read both before implementing anything non-trivial. Read `CONTEXT_BUILDER_PLAN.md` before touching anything in `context-builder/`.

## Stack

- **Runtime:** Bun (not Node, not tsx — Bun APIs throughout)
- **Frontend:** SvelteKit
- **AI (current):** OpenAI GPT-4o — used for both extraction and synthesis during early development
- **AI (target):** Ollama (`qwen2.5:14b`) for extraction, Claude Sonnet 4.6 for synthesis
- **DB:** Postgres via DrizzleORM (Bun SQL driver), running on pronix (`192.168.10.85`)
- **OS:** NixOS

## OpenAI API rules

- **Always pass `store: false`** on every OpenAI API call. No exceptions. This prevents request/response storage on OpenAI's servers.

## Architecture rules (non-negotiable)

- **Ollama extracts, Sonnet synthesizes.** Ollama outputs only structured JSON — no prose, no judgments. Sonnet sees only compressed Ollama output, never raw email HTML.
- **No vector stores.** Decided, not revisiting. All retrieval is explicit keyword/entity lookup against Postgres.
- **Diary content never reaches any cloud API.** This constraint must be enforced at the code level — there must be no call path from the diary reader to any Sonnet API call.
- **Prompt changes require human approval.** The weekly meta-run proposes diffs; nothing auto-applies. The `prompt_versions` table tracks active prompts. The `/prompts` dashboard page handles review and activation.
- **Dashboard is the primary interface — never send emails for system events.** The user's goal is to not read email. Errors, alerts, and notifications go to the dashboard only (via `pipeline_runs`, `notes`, or the UI). The `send_email` skill and `nodemailer` exist only for user-initiated AI actions, not system monitoring.

## Shared configs — don't duplicate

- **Email accounts:** `email-accounts.json` in the project root, loaded via `src/config/email-accounts.ts` → `loadEmailAccounts()`. Both the pipeline and the Context Builder use this. Never create a separate email config in `context-builder/`.
- **RSS feeds:** `src/config/rss-feeds.ts`
- **DB:** `src/db/index.ts` — re-export everything from there, don't create new DB connections elsewhere.

## Key schema tables

See `MORNING_BRIEFING_PLAN.md §8` for full schema. Critical ones:

- `raw_items` — all ingested content before processing
- `extractions` — Ollama output per item, with effective relevance scores
- `active_topics` — running story summaries, continuity across days
- `entities` / `entity_relations` — knowledge graph nodes and edges
- `source_quality` / `source_daily_scores` — per-source trust scores and 30-day rolling history
- `prompt_versions` — versioned prompts, only one active per section at a time
- `skill_executions` — audit log for all Claude Code bridge skill calls
- `standing_context` — persistent rules/preferences injected into Section 2 prompt; seeded by Context Builder from Google Keep "Daily Life Rules" and other standing rules
- `context_builder_runs` / `context_builder_indexed_items` — Context Builder run history and per-item index state; used for delta detection on re-runs
- `notes` — user and system notes, scoped by `global | intel | personal | contact | search`
- `feedback_events` — explicit +/- ratings and implicit behavioral signals per extraction
- `push_subscriptions` — Web Push VAPID subscriptions for PWA notifications

## DB migrations

`drizzle-kit migrate` hangs in this environment. **Always apply schema changes manually** via a temporary Bun script using `new SQL(DATABASE_URL)`. After applying, delete the temp script. The `migrations/` folder and DrizzleORM schema stay in sync for reference, but the actual migration is applied raw.

## Dashboard routes

- `/[date]` — daily report, pipeline trigger, stats bar
- `/sources` — source quality dashboard (trust scores, include rates, enable/disable)
- `/entities` — entity graph explorer (filterable table)
- `/notes` — notes management (view/add/delete user notes; system notes shown read-only)
- `/skills` — skill execution log
- `/prompts` — prompt version management (view, activate, delete)
- `/questions` — pending question gate sessions

## Cron schedule (all `Europe/Berlin`)

- Daily pipeline: configurable via `PIPELINE_RUN_TIME` env var (default 06:30)
- Implicit feedback: 22:00 daily
- Weekly source quality scoring: Sunday 23:00
- Weekly review conversation: Sunday 20:00
- Weekly meta-run (analytics + prompt diff): Sunday 23:30
- Entity graph pruning: Sunday 02:00

## Skills

Skills are TypeScript modules in `/skills/`, auto-discovered on server start. The bridge runs on `localhost:4000` (never internet-exposed).

Risk levels:
- `low` — auto-execute immediately
- `medium` — execute with prominent log entry
- `high` — inserted as `pending` in `skill_executions`, requires manual confirmation
- `critical` — always rejected; never auto-execute

Current skills: `write_note`, `delete_note`, `run_web_search`, `add_todo_item`, `complete_todo_item`, `add_calendar_event` (all low), `create_file`, `send_email` (both medium).

## Concurrency

Phase 2 (Ollama extraction): semaphore capped at 4 concurrent calls. Never raise this without testing GPU memory pressure.

Phase 3 (context assembly + web search): runs in parallel with Phase 2.

Section 1 synthesis never waits for the question gate. Section 2 blocks for up to 45 minutes.

## Sonnet output parsing

Both Sonnet calls append a machine-readable `<!--SYSTEM ... -->` JSON block at the end of their output. Phase 6 parses this block to drive all memory writes (new topics, entity upserts, contact updates, skill suggestions). Do not add a separate Sonnet call for Phase 6 logic.

## Error handling model

Every pipeline step is wrapped in `withRetry` (`src/pipeline/withRetry.ts`). Rules:

- Each step is retried up to **3 times** on failure (delays: 2 s after attempt 1, 5 s after attempt 2).
- Each failed attempt is recorded as a `StepAttemptError` with `{step, attempt, error, stack, ts}`.
- When all 3 attempts fail, a `StepError` is thrown with the full attempt log.
- `run.ts` catches `StepError` and writes the run outcome to the `pipeline_runs` table: `status`, `failed_step`, `step_errors` (JSONB array), `duration_ms`.
- The dashboard reads `pipeline_runs` and renders a detailed error card showing which step failed, each attempt's error message and timestamp, and an expandable stack trace.

When adding a new pipeline phase, always wrap the call with `withRetry("phaseN", () => runPhaseN(...))` — never call phase functions directly in `run.ts`.

## Privacy

Never use real personal information in code, comments, or examples — no real email addresses, names, phone numbers, or other PII. Use placeholders like `user@example.com` instead.

## What to build next

See `TODO.md` for the current phase and open items. Phases 0–6 are complete. The Context Builder scaffolding is done. What remains before a first real run: Ollama setup, gkeepapi auth (`context-builder/scripts/keep-auth.py`).

## What not to build (yet)

- Phase 7 passive context sources (Keep as daily pipeline source, chat history, diary) — only after Phase 6 is stable and the core pipeline has run for 2+ weeks.
- Slots 4 and 5 of the web search module — only after day 60
- Any `critical`-risk skills — test manually for 2 weeks before adding
- Netzpolitik.org as a 33rd source — evaluate at the 30-day mark

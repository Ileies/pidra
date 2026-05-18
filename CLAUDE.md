# CLAUDE.md — PIDRA

## What this project is

PIDRA is a personal morning briefing system. It ingests 32 newsletters, personal emails, SMS, Google Calendar, and Google Tasks via RSS, IMAP, and APIs. 24 of the 32 newsletters are fetched via RSS (cleaner content); the remaining 8 that have no public RSS feed are fetched via IMAP. Two Ollama passes compress raw content into structured JSON; one Sonnet call synthesizes each section of the report. The system compounds over time through an entity knowledge graph, source trust scoring, and weekly self-improvement runs.

Full architecture is in `MORNING_BRIEFING_PLAN.md`. All decisions and rationale are in `CONTEXT_AND_DECISIONS.md`. Read both before implementing anything non-trivial.

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
- **Prompt changes require human approval.** The weekly meta-run proposes diffs; nothing auto-applies. The `prompt_versions` table tracks active prompts.

## Key schema tables

See `MORNING_BRIEFING_PLAN.md §8` for full schema. Critical ones:

- `raw_items` — all ingested content before processing
- `extractions` — Ollama output per item, with effective relevance scores
- `active_topics` — running story summaries, continuity across days
- `entities` / `entity_relations` — knowledge graph nodes and edges
- `source_quality` — per-source trust scores (0.5–2.0 multiplier)
- `prompt_versions` — versioned prompts, only one active per section at a time
- `skill_executions` — audit log for all Claude Code bridge skill calls

## Concurrency

Phase 2 (Ollama extraction): `Promise.allSettled` with a semaphore capped at 4 concurrent calls. Never raise this without testing GPU memory pressure.

Phase 3 (context assembly + web search): runs in parallel with Phase 2.

Section 1 synthesis never waits for the question gate. Section 2 blocks for up to 45 minutes.

## Sonnet output parsing

Both Sonnet calls append a machine-readable `<!--SYSTEM ... -->` JSON block at the end of their output. Phase 6 parses this block to drive all memory writes (new topics, entity upserts, contact updates, skill suggestions). Do not add a separate Sonnet call for Phase 6 logic.

## Skills bridge

The Claude Code bridge is a local REST API (`localhost` only, never internet-exposed). Skills are TypeScript modules in `/skills`, auto-discovered on restart. Each skill declares a `risk_level` (low / medium / high / critical). `critical` skills always require explicit confirmation and have a 30-second built-in delay after confirmation. All executions are logged to `skill_executions`.

## Error handling model

Every pipeline step is wrapped in `withRetry` (`src/pipeline/withRetry.ts`). Rules:

- Each step is retried up to **3 times** on failure (delays: 2 s after attempt 1, 5 s after attempt 2).
- Each failed attempt is recorded as a `StepAttemptError` with `{step, attempt, error, stack, ts}`.
- When all 3 attempts fail, a `StepError` is thrown with the full attempt log.
- `run.ts` catches `StepError` and writes the run outcome to the `pipeline_runs` table: `status`, `failed_step`, `step_errors` (JSONB array), `duration_ms`.
- The dashboard reads `pipeline_runs` and renders a detailed error card showing which step failed, each attempt's error message and timestamp, and an expandable stack trace.

When adding a new pipeline phase, always wrap the call with `withRetry("phaseN", () => runPhaseN(...))` — never call phase functions directly in `run.ts`.

## What to build next

See `TODO.md` for the current phase and open items.

## What not to build (yet)

- Phase 7 passive context sources (Keep, chat history, diary) — only after Phase 6 is stable and the core pipeline has run for 2+ weeks
- Slots 4 and 5 of the web search module — only after day 60
- Any `critical`-risk skills — test manually for 2 weeks before adding
- Netzpolitik.org as a 33rd source — evaluate at the 30-day mark

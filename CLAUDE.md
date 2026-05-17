# CLAUDE.md — PIDRA

## What this project is

PIDRA is a personal morning briefing system. It ingests 32 newsletters, personal emails, SMS, Google Calendar, and Google Tasks via IMAP and APIs. Two Ollama passes compress raw content into structured JSON; one Sonnet call synthesizes each section of the report. The system compounds over time through an entity knowledge graph, source trust scoring, and weekly self-improvement runs.

Full architecture is in `MORNING_BRIEFING_PLAN.md`. All decisions and rationale are in `CONTEXT_AND_DECISIONS.md`. Read both before implementing anything non-trivial.

## Stack

- **Runtime:** Bun (not Node, not tsx — Bun APIs throughout)
- **Frontend:** SvelteKit
- **Local AI:** Ollama (`qwen2.5:14b`, Q4_K_M)
- **Cloud AI:** Claude Sonnet 4.6
- **DB:** Postgres via DrizzleORM
- **OS:** NixOS

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

## What to build next

See `TODO.md` for the current phase and open items.

## What not to build (yet)

- Phase 7 passive context sources (Keep, chat history, diary) — only after Phase 6 is stable and the core pipeline has run for 2+ weeks
- Slots 4 and 5 of the web search module — only after day 60
- Any `critical`-risk skills — test manually for 2 weeks before adding
- Netzpolitik.org as a 33rd source — evaluate at the 30-day mark

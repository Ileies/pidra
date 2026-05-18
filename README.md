# PIDRA — Personal Ingestive Daily Report Agent

AI-powered morning briefing system. Ingests 32 curated newsletters, personal emails, SMS, calendar, and to-do lists. Produces a structured two-section report every morning. Gets smarter over time through feedback loops, an entity knowledge graph, and weekly self-improvement runs.

## Output

**Section 1 — Intelligence Briefing**
World-facing intelligence organized by topic domain (AI, China, Finance, Science, etc.). Cross-referenced with previous reports — never re-explains background, only surfaces updates and novel developments.

**Section 2 — Personal Action Center**
Life logistics: emails requiring response, payment deadlines, upcoming calendar events, tasks approaching due dates, SMS follow-ups. Prioritized by urgency. Cross-linked with calendar and to-do list.

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Bun |
| Frontend | SvelteKit (dashboard + PWA) |
| Local AI | Ollama — qwen2.5:14b |
| Cloud AI | Claude Sonnet 4.6 |
| Database | Postgres + DrizzleORM |
| Email | IMAP (Netcup) |
| Calendar / Tasks | Google Calendar API + Google Tasks API |
| Web search | Brave Search API (free tier to start) |
| Push notifications | Web Push API (PWA) |
| Scheduling | Bun cron |
| OS | NixOS (self-hosted Netcup server) |

## Architecture

Three paradigms combined:

- **Map-Reduce spine (B):** Every item independently extracted by Ollama → structured JSON → merged into a Sonnet synthesis payload
- **Structured memory layer (C):** All continuity through explicit Postgres tables (active topics, entity graph, source quality, prompt versions) — no vector stores
- **Topic-graph output (D):** Section 1 organized by domain, not source. Entity knowledge graph enriches synthesis with relationship context.

Plus a **compounding intelligence layer**: feedback loops, source trust scoring, entity graph growth, and a weekly self-improvement run (human approval required for all prompt changes).

## Key Design Decisions

- **Ollama is a compressor, not an analyst.** Converts text → structured JSON. Sonnet synthesizes — it only sees compressed output (~12K tokens), not raw email HTML (~50K tokens).
- **No vector stores.** Cosine similarity thresholds silently drop items. For a daily briefing where completeness matters, explicit structured extraction wins.
- **Diary content never reaches a cloud API.** Hard architectural rule, not a configurable option.
- **No prompt changes without human approval.** System proposes weekly, user approves each change individually.

## Planning Documents

All architecture decisions, prompts, schema, and build rationale are in the planning docs — read these before touching any implementation:

- [`MORNING_BRIEFING_PLAN.md`](./MORNING_BRIEFING_PLAN.md) — Complete build plan: architecture, pipeline, DB schema, prompts, delivery, cost analysis, full roadmap
- [`CONTEXT_AND_DECISIONS.md`](./CONTEXT_AND_DECISIONS.md) — Builder profile, intelligence priorities, newsletter selection rationale, key decisions made, design principles

## Build Status

Pre-implementation. Planning phase complete. See [`TODO.md`](./TODO.md) for the phase-by-phase build plan.

## Error Handling

Every pipeline step is wrapped in a retry layer (`src/pipeline/withRetry.ts`):

- Each step is retried up to **3 times** on failure (2 s → 5 s backoff).
- Each failed attempt is recorded with step name, attempt number, error message, stack trace, and timestamp.
- After 3 failures the pipeline is marked as failed in the `pipeline_runs` DB table.
- The dashboard shows a detailed error card: which step failed, all attempt errors with timestamps, and expandable stack traces — so failures are debuggable without reading server logs.

## Monthly Cost Estimate

~$2.20–7.20/month (Sonnet API + optional web search). Ollama runs locally at $0.

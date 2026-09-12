# PIDRA - Personal Ingestive Daily Report Agent

AI-powered morning briefing system. Phase 1 pulls from 16 independent sources every morning - 13 mailboxes over IMAP, 24 newsletter feeds over RSS, Google Calendar and Google Tasks - and SMS arrives separately by webhook. 32 curated newsletters in total, the rest of them by mail. Produces a structured two-section report and pushes it to the phone. Gets smarter over time through feedback loops, an entity knowledge graph, and weekly self-improvement runs.

## Output

**Section 1 - Intelligence Briefing**
World-facing intelligence organized by topic domain (AI, China, Finance, Science, etc.). Cross-referenced with previous reports - never re-explains background, only surfaces updates and novel developments.

**Section 2 - Personal Action Center**
Life logistics: emails requiring response, payment deadlines, upcoming calendar events, tasks approaching due dates, SMS follow-ups. Prioritized by urgency. Cross-linked with calendar and to-do list.

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Bun |
| Frontend | SvelteKit (dashboard + PWA) |
| AI (current) | OpenAI GPT-5.6 Luna - both extraction and synthesis |
| AI (target) | Ollama (`qwen2.5:14b`) for extraction, Claude Sonnet 4.6 for synthesis |
| Database | Postgres + DrizzleORM |
| Email | IMAP (Netcup) |
| Calendar / Tasks | Google Calendar API + Google Tasks API |
| Web search | Brave Search API (free tier to start) |
| Push notifications | Web Push API (PWA), VAPID |
| Scheduling | systemd timers on the host, one one-shot unit per job |
| OS | NixOS (self-hosted on `pronix`) |

## Architecture

Three paradigms combined:

- **Map-Reduce spine (B):** Every item independently extracted → structured JSON → merged into a synthesis payload
- **Structured memory layer (C):** All continuity through explicit Postgres tables (active topics, entity graph, source quality, prompt versions) - no vector stores
- **Topic-graph output (D):** Section 1 organized by domain, not source. Entity knowledge graph enriches synthesis with relationship context.

Plus a **compounding intelligence layer**: feedback loops, source trust scoring, entity graph growth, and a weekly self-improvement run (human approval required for all prompt changes).

## Key Design Decisions

- **Extraction is a compressor, not an analyst.** Converts text → structured JSON. Synthesis only sees compressed output (~12K tokens), not raw email HTML (~50K tokens). Both stages currently run on `gpt-5.6-luna`; which model fills each stage is not the rule, the two-stage split is.
- **No vector stores yet.** Cosine similarity thresholds silently drop items. For a daily briefing where completeness matters, explicit structured extraction wins. A vector store is planned, but as its own far-future project, not an incremental pipeline addition.
- **Credentials never reach any cloud API.** Diary and other intimate personal content is deliberately in scope for the Context Builder - it's some of the richest signal available. Only credentials (passwords, card/bank details, ID numbers) are filtered before any consumer sees them.
- **No prompt changes without human approval.** System proposes weekly, user approves each change individually.

## Tools

PIDRA is three tools sharing one Postgres database:

| Tool | Entry point | Purpose |
|---|---|---|
| **Daily pipeline** | `bun run job pipeline` | Morning briefing. Runs at 06:30 |
| **Dashboard** | `bun run dashboard` (dev) | SvelteKit UI for reading reports, rating, managing notes |
| **Context Builder** | `bun run context-builder` | Comprehensive scan of all personal data - seeds entities, contacts and standing rules. Runs monthly in update mode; `--full` rebuilds from scratch, `--dry-run` reports the inventory and exits |

## Scheduled jobs

`src/job.ts` runs exactly one job and exits, so a failure lands in `systemctl --failed` and `systemctl list-timers` shows the real next run - neither of which a single long-lived scheduler process gives you. The units are generated from one attribute set in `hosts/pronix/pidra.nix` in the NixOS flake; adding a job means one entry in `JOBS` and one there. All times `Europe/Berlin`.

| Job | Schedule |
|---|---|
| `pipeline` | daily 06:30 |
| `feedback` | daily 22:00 |
| `prune` | Sunday 02:00 |
| `review` | Sunday 20:00 |
| `source-scoring` | Sunday 23:00 |
| `meta-run` | Sunday 23:30 |
| `context-builder` | 1st of the month, 03:00 |

## Planning Documents

All architecture decisions, prompts, schema, and build rationale are in the planning docs - read these before touching any implementation:

- [`MORNING_BRIEFING_PLAN.md`](./MORNING_BRIEFING_PLAN.md) - Complete build plan: architecture, pipeline, DB schema, prompts, delivery, cost analysis, full roadmap
- [`CONTEXT_AND_DECISIONS.md`](./CONTEXT_AND_DECISIONS.md) - Builder profile, intelligence priorities, newsletter selection rationale, key decisions made, design principles
- [`CONTEXT_BUILDER_PLAN.md`](./CONTEXT_BUILDER_PLAN.md) - Context Builder architecture, run modes (full/update/resume), pipeline phases, cost analysis, testing checklist
- [`DASHBOARD_PLAN.md`](./DASHBOARD_PLAN.md) - The dashboard redesign: the mobile audit, the phase breakdown A through E, the settled decisions, and the far-future semantic search design
- [`CONTEXT_REVISION_PLAN.md`](./CONTEXT_REVISION_PLAN.md) - How corrections to the harvested context work: the append-only layer, and why the harvest itself is never rewritten

## Build Status

Phases 0-6 of the daily pipeline are complete and the whole chain runs unattended: as of 2026-09-12 a run ingests all 16 sources, synthesises both sections and delivers the push notification without intervention.

The dashboard redesign in `DASHBOARD_PLAN.md` is executed and closed, M-9 included, so the app has been through a real device pass on iOS and Android. The Context Builder is complete, has had one full harvest plus update runs, and now re-harvests monthly on the server, which is also what keeps its output readable by the pipeline.

See [`TODO.md`](./TODO.md) for open items.

## Error Handling

Every pipeline step is wrapped in a retry layer (`src/pipeline/withRetry.ts`):

- Each step is retried up to **3 times** on failure (2 s → 5 s backoff).
- Each failed attempt is recorded with step name, attempt number, error message, stack trace, and timestamp.
- After 3 failures the pipeline is marked as failed in the `pipeline_runs` DB table, and a push notification names the failed step and links to `/runs`. Silence used to be indistinguishable from "still running".
- The dashboard shows a detailed error card: which step failed, all attempt errors with timestamps, and expandable stack traces - so failures are debuggable without reading server logs.

A **partial** ingest failure is not a failed run. Phase 1 settles all 16 sources independently and throws only if every one of them failed, so a single dead mailbox or a revoked credential degrades the briefing instead of cancelling it. Those per-source errors ride along in `step_errors` on a run whose status stays `completed`, and `/runs` shows them - the status reflects "a report was written", the errors say what it was written without.

## Cost

Measured, and only for what the system actually tracks. `daily_reports` records synthesis tokens: the 2026-09-12 run was 25.6k in / 3.9k out, about a cent at `gpt-5.6-luna` list prices ($0.20 / $1.20 per Mtok). Every call runs on `service_tier: "flex"`, so the real spend is below the dashboard's figure, which prices at list.

Extraction is not tracked per run and sits on top of that. The Context Builder prints its own running total: the 2026-09-12 monthly update was $0.05 for 177 items; a full harvest is the expensive one, estimated in `CONTEXT_BUILDER_PLAN.md`.

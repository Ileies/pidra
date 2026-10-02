# PIDRA - Personal Ingestive Daily Report Agent

AI-powered morning briefing. Every morning it pulls from the configured IMAP mailboxes, newsletter RSS feeds, Google Calendar and Google Tasks (SMS arrives separately by webhook), and six web-search news desks research the day's news. The result is a structured three-section report, pushed to the phone. It improves over time through feedback loops, an entity knowledge graph and weekly self-improvement runs.

## Output

**Section 2 - Personal Action Center** (shown first)
Life logistics: emails needing a reply, payment deadlines, calendar events, tasks approaching their due date, SMS follow-ups. Prioritised by urgency and cross-linked with the calendar and to-do list.

**News**
What happened since the last briefing, researched by six web-search desks: the world's front page, the home city and country, the reader's first priority as a beat, their other fields, what people are talking about, and one thing they would never have looked for. Every story is checked in code against what the search returned, and every link is a checked source.

**Section 1 - Intelligence Briefing**
World-facing intelligence from the newsletters, organised by topic domain (AI, China, Finance, Science, ...). Cross-referenced with previous reports: it never re-explains background, only surfaces updates and new developments.

## Tech stack

| Layer | Technology |
|---|---|
| Runtime | Bun |
| Frontend | SvelteKit (dashboard, installable PWA that works offline) |
| AI | OpenAI Responses API. `OPENAI_MODEL_EXTRACTION` and `OPENAI_MODEL_SYNTHESIS` select the models; both default to `gpt-6-luna` |
| Database | Postgres + DrizzleORM |
| Email | IMAP |
| Calendar / Tasks | Google Calendar API + Google Tasks API |
| Web search | Brave Search API only, for the news desks and the Section 1 slots |
| Push | Web Push (VAPID) |
| Scheduling | systemd timers, one one-shot unit per job |
| OS | NixOS, self-hosted on `pronix` |

## Architecture

- **Map-reduce spine:** every item is extracted independently into structured JSON, then merged into a synthesis payload.
- **Structured memory:** continuity lives in explicit Postgres tables (active topics, entity graph, source quality, prompt versions), not in a vector store.
- **Topic-graph output:** Section 1 is organised by domain, not by source, and the entity graph adds relationship context to synthesis.
- **Compounding loop:** feedback, source trust scoring, entity graph growth and a weekly self-improvement run. Every prompt change needs human approval.

## Key design decisions

The full invariants are in [`docs/architecture-rules.md`](./docs/architecture-rules.md). The ones that shape everything else:

- **Extraction compresses, synthesis writes.** Extraction turns text into structured JSON; synthesis sees only that compressed output (~12K tokens), never raw email HTML (~50K tokens). The two-stage split is the rule, not which model fills each stage.
- **No vector store in the pipeline.** A similarity threshold silently drops items, and a daily briefing has to be complete. A vector store is planned for archive search only, as its own project.
- **Credentials never reach a cloud API.** Other personal content, diary included, is deliberately in scope for the Context Builder.
- **No prompt change without human approval.** The system proposes weekly; the owner approves each change.
- **The briefing works without the network.** The dashboard is read on a train. The phone keeps a local IndexedDB copy of the last 60 briefings, the notes, the rules, the context document and the reference tables, so every mirrored page opens without waiting on the network. Notes, rule edits and ratings made offline are queued and delivered in order on reconnect; anything acting on live state says it needs the connection. Every request has a hard time budget, and an unreachable server is detected within about 3.5 s even when packets vanish silently. Details in [`docs/offline-mode.md`](./docs/offline-mode.md).

## Tools

Three tools share one Postgres database:

| Tool | Entry point | Purpose |
|---|---|---|
| **Daily pipeline** | `bun run job pipeline` | The morning briefing, 06:30 |
| **Dashboard** | `bun run dashboard` (dev) | SvelteKit UI for reading reports, rating, notes, entities, runs and approvals |
| **Context Builder** | `bun run context-builder` | Scans all personal data and seeds entities, contacts and standing rules. Runs monthly in update mode; `--full` rebuilds, `--dry-run` reports the inventory and exits. See [`context-builder/README.md`](./context-builder/README.md) |

## Scheduled jobs

`src/job.ts` runs exactly one job and exits, so a failure shows up in `systemctl --failed` and `systemctl list-timers` shows the real next run. The units are generated from one attribute set in `hosts/pronix/pidra.nix` in the NixOS flake. Adding a job means one entry in `JOBS` and one there. All times `Europe/Berlin`.

| Job | Schedule |
|---|---|
| `pipeline` | daily 06:30 |
| `feedback` | daily 22:00 |
| `prune` | Sunday 02:00 |
| `review` | Sunday 20:00 |
| `source-scoring` | Sunday 23:00 |
| `meta-run` | Sunday 23:30 |
| `context-builder` | 1st of the month, 03:00 |

## Deploying

`bun run deploy` sends the committed tree to pronix: pull, sync the gitignored config and harvest files, install, build the dashboard, restart the two long-lived units, then verify that the pages actually render. It refuses an uncommitted tree, unpushed commits, a branch behind origin, a dirty checkout on the server, or a failing `bun run check`. It does not carry `.env` or the systemd units. Flags, refusals and the units' `nixos-rebuild` caveat are in [`docs/operations.md`](./docs/operations.md).

## Documentation

- [`CLAUDE.md`](./CLAUDE.md) - project instructions and the index of everything under [`docs/`](./docs/), one file per concern: architecture rules, dashboard, offline mode, operations, security, scoring, prompt tuning, sources.
- [`docs/todo/`](./docs/todo/README.md) - all open work, split by horizon.

## Status

Phases 0-6 are complete and the pipeline runs unattended end to end. The dashboard, Context Builder (monthly re-harvest on the server) and offline mode are built; offline mode is proven in headless Chrome, and the check on a real phone is open work in [`docs/todo/user.md`](./docs/todo/user.md).

## Error handling

Every pipeline step is wrapped in `withRetry` (`src/pipeline/withRetry.ts`): up to 3 attempts (2 s, then 5 s backoff), every failed attempt recorded with step, error, stack and timestamp. After the third failure the run is marked failed in `pipeline_runs`, a push names the failed step and links to `/runs`, and the dashboard shows an error card with every attempt.

A **partial** ingest failure is not a failed run. Phase 1 settles all sources independently and throws only if every one failed, so a dead mailbox or revoked credential degrades the briefing instead of cancelling it. Those errors ride along in `step_errors` on a run that stays `completed`, and the report shows an ingest warning (`docs/architecture-rules.md`).

## Cost

Token use and web-search counts are tracked per run and per step and shown on `/runs`; cost renders only when `PUBLIC_MODEL_PRICE_IN_PER_MTOK` and `PUBLIC_MODEL_PRICE_OUT_PER_MTOK` are set. Prices are list prices, and every call runs on the `flex` service tier, so real spend is lower than the figure shown.

The news desks are the largest daily cost: most of their input tokens are search results. Brave calls are billed per call on top of tokens, are capped at 30 per day across all callers, and appear in the report's "web searches" figure rather than its cost.

# CLAUDE.md - PIDRA

## What this project is

PIDRA consists of three tools that share one Postgres database:

1. **Daily pipeline** (`src/`, entered through `src/job.ts`) - morning briefing system. Ingests 32 curated newsletters, personal email, SMS (`POST /webhook/sms` in `src/server/routes/sms.ts`, authenticated by the `X-SMS-Secret` header against `SMS_WEBHOOK_SECRET`; every request is rejected while that variable is unset), Google Calendar and Google Tasks over RSS, IMAP and APIs. Six **news desks** (`src/news/`) research the day's news on the web: the world's front page, the reader's home city and country, their first priority as a beat, their other fields, talk of the day, and something different. Extraction compresses raw content into structured JSON; synthesis writes each section (both stages run on `gpt-6-luna`, see Stack). It compounds through entity mention provenance, source trust scoring and weekly self-improvement runs.

2. **Dashboard** (`dashboard/`) - SvelteKit frontend for reading reports, rating items, viewing the entity graph, managing notes, reviewing skill executions, and approving prompt changes.

3. **Context Builder** (`context-builder/`) - performs a comprehensive scan of all personal data sources (all email accounts, Google Keep, Google Tasks, GitHub) and builds a structured long-term context document. Seeds the `entities` and `contacts` tables and the Keep standing rules (as `personal` notes) before the first pipeline run - so the system is calibrated from day one instead of learning from scratch. Re-runs monthly in update mode (delta only, proportional merge), as the `context-builder` job. Architecture in `docs/context-builder.md`.

   **The output document's `# 1.` to `# 5.` headings are an interface, not formatting.** `pickSections` (`src/pipeline/long-term-context.ts`) splits on them to route each section to one of the two daily synthesis calls, so a document that answers in any other shape reaches synthesis as an empty string. Both synthesis prompts share one `DOCUMENT_STRUCTURE` constant stating the contract, and `context-builder/phases/synthesize.ts` verifies the result before recording it: a patch that comes back malformed is rebuilt in full, and one that still fails leaves `document` null so the last good harvest stays the newest document the pipeline can find. Never write a prompt or a consumer that assumes a different shape on either side.

Read `docs/context-builder.md` and `context-builder/README.md` before touching anything in `context-builder/`. See "Reference docs" below for everything else.

## Reference docs

Everything under `docs/` is scoped to one concern, so a session only loads what it actually needs - check the relevant file before implementing anything non-trivial in that area, or exploring the code cold. This index should always match what's actually in `docs/`; the commit skill (see "Commit workflow" below) keeps it that way as part of every commit, so if you add or remove a doc, that's where the index gets updated, not by hand here.

- `docs/architecture-rules.md` - the non-negotiable invariants: two-stage extraction/synthesis split, no in-pipeline embeddings, contacts scope, credential filtering, harvested-context immutability, discard/failure reporting, the News section, quick actions, questions queue, reports-are-final, notes as the mutable layer, assistant surfaces, prompt approval, dashboard-only notifications. Read before any change that touches these
- `docs/dashboard.md` - every route, what it does, and the UI conventions (page widths, formatting helpers, dark/light palette, phone-first testing)
- `docs/offline-mode.md` - the mirror/outbox/service-worker architecture and the blackhole test suite
- `docs/skills.md` - risk levels, the current skill registry, and how `executeSkill()` gates calls
- `docs/operations.md` - deployment, DB access and schema changes, the cron schedule, concurrency model, synthesis output parsing, and the retry/error-handling model
- `docs/schema-notes.md` - shared configs (email accounts, RSS feeds, DB connection) and the key schema tables, with the `src/db/schema/` directory as the source of truth
- `docs/prompt-tuning-context.md` - intelligence priorities, report format rules, newsletter processing tiers. Read before touching extraction/synthesis prompts
- `docs/newsletter-sources.md` - all 32 newsletters with tier and selection rationale
- `docs/google-integration-notes.md` - Google Tasks list / Keep category meanings
- `docs/context-builder.md` - Context Builder data flow, run modes, recovery state, output contract, and daily integration
- `docs/scoring-formulas.md` - the gate, trust-score and entity-pruning formulas as currently implemented
- `docs/security.md` - current security controls, trust boundaries, and known gaps; read before changing auth, routes, skills, secrets, or deployment
- `docs/todo/README.md` - how the open-work list is split and what doesn't belong in it
- `docs/todo/now.md` - active or near-term open work
- `docs/todo/soon.md` - queued work, mostly Phase 7 sources plus the 30-day web-search check-in
- `docs/todo/later.md` - Phase 8, the critical-skills design, semantic search, and other deliberately-deferred work
- `docs/todo/security.md` - remaining security work ordered by impact
- `docs/todo/user.md` - open work blocked on the owner specifically (a device, an external account, a judgment formed over time)

## Stack

- **Runtime:** Bun (not Node, not tsx - Bun APIs throughout)
- **Frontend:** SvelteKit
- **AI:** OpenAI Responses API. `OPENAI_MODEL_EXTRACTION` and `OPENAI_MODEL_SYNTHESIS` select the models; both default to `gpt-6-luna`.
- **DB:** Postgres via DrizzleORM (Bun SQL driver), running on pronix (`192.168.10.85`)
- **OS:** NixOS

## OpenAI API rules

- **Always pass `store: false`** on every OpenAI API call. No exceptions. This prevents request/response storage on OpenAI's servers.
- **Always pass `service_tier: "flex"`.** Roughly half the cost for extra latency; 429 means "no flex capacity", so retry with backoff rather than failing the caller. `withFlexRetry` in `src/ai/openai.ts` does this.
- **`gpt-6-luna` rejects `temperature` and `max_tokens` with a hard 400.** Use `max_output_tokens` (Responses API) or `max_completion_tokens` (Chat Completions), and control determinism with strict JSON schemas plus `reasoning.effort` instead of temperature.
- **Go through `src/ai/openai.ts` for model calls.** `extractJson()` and `synthesize()` centralise the model IDs, the flex tier, `store: false`, and retries. News search uses the Brave client in `src/search/brave.ts`. Don't construct a second `new OpenAI(...)` client elsewhere.
- **Prefer strict JSON schemas for extraction.** Pass `schema` to `extractJson()`; it removes both field drift and truncated-JSON parse failures.
- **The speech endpoint is the one exception to the `store: false` and `service_tier: "flex"` rules.** `speak()` in `src/ai/openai.ts` (the report page's Play button) calls `audio.speech.create`, which has neither parameter, so neither can be passed; it still gets `withFlexRetry`. `OPENAI_MODEL_TTS` (default `gpt-4o-mini-tts`) and `OPENAI_TTS_VOICE` (default `cedar`) select model and voice. The spoken text always comes from the stored report inside `src/audio/store.ts`, never from a request, and `report_audio` is written only there and never touches `daily_reports`.
- **Never use OpenAI's hosted `web_search` tool** (owner's decision, 2026-09-25). All web search goes through the Brave Search API in `src/search/brave.ts`: the news desks, the Section 1 slots, `/api/deepen` and the `run_web_search` skill. Every actual request, including a retry, reserves one of 30 shared calls for the UTC day in `brave_daily_usage`; a full quota fails closed.

## Privacy

Never use real personal information in code, comments, or examples - no real email addresses, names, phone numbers, or other PII. Use placeholders like `user@example.com` instead.

## Code comments

Comments are written for Claude readers: every file opens with a 1-3 line role header, and exports carry contract comments for what signatures don't show (invariants, cross-file coupling). Don't restate code, narrate incident history or duplicate `docs/`.

## Development loop

While iterating on a change, run `bun run check:quick` (or `bun run check --quick` / `-q`) instead of the full `bun run check` - it skips `dashboard/scripts/blackhole/run.ts`, the step that dominates the full check's wall time (~65-70s against well under 4s for everything else combined), so you still get `svelte-check`, contrast, offline-check, component-test and `db tests` feedback without the wait. The `db tests` step (`bun run test:db`, ~2.4 s, runs in `--quick` too) runs `tests-db/` against a throwaway local Postgres and needs the binaries: `initdb`/`pg_ctl` on PATH, or nix (details in `docs/operations.md`). Reach for it by default whenever you're confident the change in flight can't touch routing, offline behavior, or rendering - most single-file edits qualify. It is never a substitute for the full check right before finishing: the `commit` skill and `bun run deploy` both require the full run regardless.

Check output is short by default: a passing step prints one `ok <step> (<secs>s): <last line>` line, a failing step or one with warnings prints its full output. Pass `--verbose` / `-v` (combinable with `--quick`) to stream every step's full output live.

## Commit workflow

Use the `commit` skill (`.claude/skills/commit/SKILL.md`, `args: "<why>"`) for non-trivial changes - it runs checks and keeps docs in sync via `docs-committer`. For small changes (typos, one-liners, no doc impact), a plain `git commit` is fine.

Don't pre-edit `docs/**`, `README.md`, or `CLAUDE.md` yourself while implementing a change you intend to run through `/commit` - that's `docs-committer`'s entire job, and doing it twice pays the token/time cost of the doc-sync pass twice for no added safety: its own instructions only re-verify a file the calling prompt already frames as correct, rather than writing it independently, so a pre-written mistake (e.g. a todo entry "closed" by annotation instead of by deletion, which this repo's convention requires) has an actual chance of surviving review instead of being caught. Note what changed and why as you go, then hand that reasoning to `/commit`'s args and let `docs-committer` write the prose.

## What's next

`docs/todo/` holds all open work, split by horizon (see `docs/todo/README.md`); closed entries are removed rather than struck through. Phases 0-6 are complete and the pipeline runs unattended end to end. The thing that most wants doing: running the pipeline and the News section against real mornings for a week or more to tune the extraction and news-desk prompts, which have never been judged on much material.

Deliberately not building yet: Phase 7 passive context sources (`docs/todo/soon.md`), slots 4 and 5 of the web search module, any `critical`-risk skill (blocked on the approval-flow and agentic-loop designs in `docs/todo/later.md`).

`JEV_INTEGRATION_PLAN.md` is a proposed, not authorized, plan for using TypeSafe's Jev for narrow ranking judgments. Only the server-side adapter `src/ai/jev.ts` exists and nothing in the pipeline calls it. It is the one deliberate exception to "go through `src/ai/openai.ts`": Jev is not an OpenAI client and takes none of the OpenAI-only options.

# CLAUDE.md - PIDRA

## What this project is

PIDRA consists of three tools that share one Postgres database:

1. **Daily pipeline** (`src/`, entered through `src/job.ts`) - morning briefing system. Ingests 32 newsletters, personal emails, SMS, Google Calendar, and Google Tasks via RSS, IMAP, and APIs. Extraction compresses raw content into structured JSON; synthesis produces each section of the report - both stages currently run on `gpt-5.6-luna` (see Stack below). Compounds over time through an entity knowledge graph, source trust scoring, and weekly self-improvement runs.

2. **Dashboard** (`dashboard/`) - SvelteKit frontend for reading reports, rating items, viewing the entity graph, managing notes, reviewing skill executions, and approving prompt changes.

3. **Context Builder** (`context-builder/`) - performs a comprehensive scan of all personal data sources (all email accounts, Google Keep, Google Tasks, GitHub) and builds a structured long-term context document. Seeds the `entities`, `contacts`, and `standing_context` tables before the first pipeline run - so the system is calibrated from day one instead of learning from scratch. Re-runs monthly in update mode (delta only, proportional merge), as the `context-builder` job. Full plan in `CONTEXT_BUILDER_PLAN.md`.

   **The output document's `# 1.` to `# 5.` headings are an interface, not formatting.** `pickSections` (`src/pipeline/long-term-context.ts`) splits on them to route each section to one of the two daily synthesis calls, so a document that answers in any other shape reaches synthesis as an empty string. Both synthesis prompts share one `DOCUMENT_STRUCTURE` constant stating the contract, and `run.ts` verifies the result before recording it: a patch that comes back malformed is rebuilt in full, and one that still fails leaves `output_path` null so the last good harvest stays the newest document the pipeline can find. Never write a prompt or a consumer that assumes a different shape on either side.

Full daily pipeline architecture is in `MORNING_BRIEFING_PLAN.md`. All decisions and rationale are in `CONTEXT_AND_DECISIONS.md`. Read both before implementing anything non-trivial. Read `CONTEXT_BUILDER_PLAN.md` before touching anything in `context-builder/`.

## Stack

- **Runtime:** Bun (not Node, not tsx - Bun APIs throughout)
- **Frontend:** SvelteKit
- **AI (current):** OpenAI GPT-5.6 Luna - used for both extraction and synthesis during early development
- **AI (target):** Ollama (`qwen2.5:14b`) for extraction, Claude Sonnet 4.6 for synthesis
- **DB:** Postgres via DrizzleORM (Bun SQL driver), running on pronix (`192.168.10.85`)
- **OS:** NixOS

## OpenAI API rules

- **Always pass `store: false`** on every OpenAI API call. No exceptions. This prevents request/response storage on OpenAI's servers.
- **Always pass `service_tier: "flex"`.** Roughly half the cost for extra latency; 429 means "no flex capacity", so retry with backoff rather than failing the caller. `withFlexRetry` in `src/ai/openai.ts` does this.
- **`gpt-5.6-luna` rejects `temperature` and `max_tokens` with a hard 400.** Use `max_output_tokens` (Responses API) or `max_completion_tokens` (Chat Completions), and control determinism with strict JSON schemas plus `reasoning.effort` instead of temperature.
- **Go through `src/ai/openai.ts`.** `extractJson()` and `synthesize()` centralise the model IDs, the flex tier, `store: false`, and retries. Don't construct a second `new OpenAI(...)` client elsewhere.
- **Prefer strict JSON schemas for extraction.** Pass `schema` to `extractJson()`; it removes both field drift and truncated-JSON parse failures.

## Architecture rules (non-negotiable)

- **Extraction outputs only structured JSON** - no prose, no judgments. Synthesis sees only compressed extraction output, never raw email HTML. The two-stage split is the rule; which model fills each stage is not. Both stages currently run on `gpt-5.6-luna` (see `src/ai/openai.ts`). The local Ollama path was removed from the Context Builder on 2026-09-10: the 9B model truncated its own JSON mid-object and hit 90 s timeouts, so runs never completed.
- **No embedding path inside a pipeline phase.** All retrieval today is explicit keyword/entity lookup against Postgres, and search over the archive ships as `tsvector` keyword search. A vector store is allowed and planned - pgvector in the existing Postgres, local embeddings, hybrid ranking over the archive - but it is a large feature that gets its own design and its own project, so it never arrives as an incremental addition to a phase that is about something else. The sequencing is the rule, not a prohibition. Preconditions and the intended shape are in `TODO.md` under Later. What stays true regardless: vector retrieval is for searching the archive, never for deciding what enters a report, where a similarity threshold silently dropping an item is the failure mode that matters.
- **`contacts` is an email sender directory, not a social graph** (owner's decision, 2026-09-10). It answers "mail arrived from this address, who is that and how much should triage care", nothing more. The user's actual social circle lives on a dozen messaging platforms and **none of them will be ingested**: no Discord, WhatsApp, Instagram, WeChat, Line, KakaoTalk, VK, Zalo, Facebook, X, Telegram or LinkedIn source, neither live nor via data export. A small `contacts` table is the expected steady state, not a seeding bug: the first Context Builder run produced 6 rows from 1432 emails and that is correct. Personal relationship context comes from `standing_context` (`profile_family_and_partner`), not from here. Full reasoning in `CONTEXT_AND_DECISIONS.md §8`.
- **Credentials never reach any cloud API.** Enforced at the code level, at the fetch choke point rather than in a consumer, so no later call path can bypass it. Currently: `sources/keep.ts` drops every Keep note labelled `Credentials` (passwords, card and bank details, identity-document numbers) before any consumer sees it; the label list is `CONTEXT_BUILDER_KEEP_EXCLUDE_LABELS`. Any new personal source needs its own equivalent filter.
- **Diary and other intimate personal content is deliberately in scope** (owner's decision, 2026-09-10). The context document is meant to be thorough about who the user is, and this content is some of the richest signal available; it goes to the API like anything else, under `store: false`. This supersedes the earlier "diary content never reaches a cloud API" rule, which is now narrowed to credentials above.
- **Harvested context is never overwritten, only adjusted and complemented** (owner's decision, 2026-09-10). The Context Builder's output document and the `standing_context` rows it wrote are read-only to everything downstream. Corrections live in `context_corrections`, an append-only layer that is injected alongside the harvest and outranks it in the daily prompts; the wrong text is kept on the correction as `supersedes_text` so the model can see what it is being told to disregard. Rows are never deleted and never edited except to flip `status` to `reverted`. `entities` and `contacts` are the one exception - a correction does merge into the row, because `phase3-context` and Section 2 read them directly - but only the named fields change, the pre-merge row is snapshotted into `previous_state`, and the row is marked `locked` so a re-seed cannot clobber it. Never add a code path that rewrites the context document or an existing standing rule in place. `src/context/corrections.ts` is the single writer and carries the rest of the reasoning.
- **Every item the pipeline discards says why, in the database.** An item can leave the chain at four places - the IMAP ingest, before Phase 2, at the Phase 3 relevance gate, or by synthesis simply not citing it - and `included_in_report` is false for all four, so on its own it explains nothing. Each drop is therefore recorded where it happens: `ingest_drops` for the first, an absent extraction row plus `source_quality.is_active` for the second, `extractions.gate_*` for the third, the report's own refs for the fourth. `src/pipeline/gate.ts` owns the third decision as one pure function with a named reason per outcome - Phase 3 both filters on it and persists it, so the list handed to synthesis and the reason shown on `/[date]/triage` cannot disagree. Never add a filter that silently drops an item from a report: a new one gets a reason code, and a new personal source gets its own drop log the way `imap.ts` has one.
- **Reports are final.** `daily_reports`, `extractions`, `raw_items` and `active_topics` belong to the pipeline and to Phase 6's `<!--SYSTEM-->` parsing. No skill may write them, which means the assistant cannot: `read_report` is read-only and is the only skill that touches a report at all. `scripts/check-skill-writes.ts` (part of `bun run check`) fails the build if a skill ever inserts, updates or deletes one of those tables. A wrong fact in a report is fixed forward - a note for tomorrow, or a `revise_context` correction for every future briefing - never by rewriting what the pipeline produced.
- **Notes are the mutable working layer, and the only one.** Unlike the harvest, `notes` rows are edited in place - but only through `src/notes/store.ts`, the single writer. Every mutation appends the pre-change state to `note_revisions` and a delete only sets `deleted_at`, so both the dashboard and the chat can undo. Every reader must filter `deleted_at IS NULL` (currently `phase3-context.ts` and `search/slots.ts`). Never write `notes` directly from a new caller; never give the harvest this treatment.
- **The assistant's capabilities are per page, enforced at the choke point.** `src/ai/surfaces.ts` maps each dashboard route to a surface with a declared skill list, a prompt fragment and the widget's example sentences. `executeSkill` checks the surface before the risk level and logs a rejection to `skill_executions`; the chat loop additionally only offers that surface's tools. An unknown route falls back to `global`, which touches nothing structural, and a client-claimed surface can never widen what its route allows. `send_email`, `send_mail` and `create_file` are on no surface at all.
- **Prompt changes require human approval.** The weekly meta-run proposes diffs; nothing auto-applies. The `prompt_versions` table tracks active prompts. The `/prompts` dashboard page handles review and activation. `prompt_versions` is an override layer, not the source of truth: the constants in `src/ai/prompts.ts` are the baseline, and an active row replaces the baseline for its section. Every stage resolves its prompt at run time through `src/ai/active-prompts.ts` (never at import time), so activating a version takes effect on the next run without a deploy, and an empty table means the code baseline runs. A stage that imports a prompt constant directly is a bug - it makes the approval flow decorative.
- **Dashboard is the primary interface - never send emails for system events.** The user's goal is to not read email. Errors, alerts, and notifications go to the dashboard only (via `pipeline_runs`, `notes`, or the UI). The `send_email` skill and `nodemailer` exist only for user-initiated AI actions, not system monitoring.

## Shared configs - don't duplicate

- **Email accounts:** `email-accounts.json` in the project root, loaded via `src/config/email-accounts.ts` → `loadEmailAccounts()`. Both the pipeline and the Context Builder use this. Never create a separate email config in `context-builder/`.
- **RSS feeds:** `src/config/rss-feeds.ts`
- **DB:** `src/db/index.ts` - re-export everything from there, don't create new DB connections elsewhere.

## Key schema tables

See `MORNING_BRIEFING_PLAN.md §8` for full schema. Critical ones:

- `raw_items` - all ingested content before processing
- `extractions` - the extraction stage's structured output per item, with effective relevance scores and the Phase 3 gate verdict (`gate_passed`, `gate_reason`, `gate_detail`)
- `ingest_drops` - mail the IMAP ingest discarded before it became a `raw_items` row, with the rule that discarded it
- `active_topics` - running story summaries, continuity across days
- `entities` / `entity_relations` - knowledge graph nodes and edges
- `source_quality` / `source_daily_scores` - per-source trust scores and 30-day rolling history
- `prompt_versions` - versioned prompts, only one active per section at a time
- `skill_executions` - audit log for all Claude Code bridge skill calls
- `standing_context` - persistent rules/preferences injected into Section 2 prompt; seeded by Context Builder from Google Keep "Daily Life Rules" and other standing rules
- `context_builder_runs` / `context_builder_indexed_items` - Context Builder run history and per-item index state; used for delta detection on re-runs
- `context_corrections` - append-only correction layer over the harvested long-term context; injected into both synthesis prompts and authoritative over them
- `chat_conversations` / `chat_messages` - the context revision chat's transcript, and the provenance trail for every correction it made
- `notes` - user and system notes, scoped by `global | intel | personal | contact | search`; editable in place, soft-deleted via `deleted_at`
- `note_revisions` - append-only pre-change state per note mutation, with the skill execution and conversation that caused it; drives the undo and the history panel on `/notes`
- `feedback_events` - explicit +/- ratings and implicit behavioral signals per extraction
- `push_subscriptions` - Web Push VAPID subscriptions for PWA notifications

## DB migrations

`drizzle-kit migrate` hangs in this environment. **Always apply schema changes manually** via a temporary Bun script using `new SQL(DATABASE_URL)`. After applying, delete the temp script. The `migrations/` folder and DrizzleORM schema stay in sync for reference, but the actual migration is applied raw.

## Deployment

**`bun run deploy` is how pronix gets new code. Never assemble the steps by hand.** A deploy is a pull plus the three things a pull cannot carry - the gitignored config and harvest files, the dependency install, and the dashboard build - and doing it manually is how `dashboard/build/` ends up a version behind its source, silently, because nothing about a stale build looks broken. `scripts/deploy.ts` also verifies more than systemd does: it follows `/` past its redirect and requests `/context-builder`, because a broken page still leaves a unit reporting `active`.

Flags: `--dry-run` prints every step without touching the server, `--push` pushes the branch instead of refusing, `--skip-check` skips `bun run check`, `--host <alias>` targets something other than `ros`.

It refuses rather than improvises: an uncommitted tree, commits not on origin (the server pulls from a *public* repo, so a deploy publishes them), a local branch behind origin, a dirty tree on the server, or a failing check in either the root or `dashboard/`.

Two things it deliberately does not carry:

- **`.env`**, on either machine. Both files hold the same keys with different values - the server reaches Postgres locally, the workstation through a forward - so a copy in either direction breaks the other. Same for `context-builder/.checkpoint.json` and `errors.json`: the server runs its own monthly harvest and those are its live state, not a stale mirror. A new key means editing both `.env` files by hand.
- **The systemd units.** They live in `hosts/pronix/pidra.nix` in the nixos flake, so a change to a unit, a timer, or the firewall needs `nixos-rebuild` **on pronix** and is not part of a deploy at all. A deploy that should have been a rebuild fails silently: the code lands and the unit keeps its old definition.

## Dashboard routes

**Every page is declared once, in `dashboard/src/lib/routes.ts`.** The navbar, the mobile tab bar and the assistant's client-side surface fallback all render from that registry, and `scripts/check-route-surfaces.ts` (part of the root `bun run check`) fails the build when a registry entry's surface disagrees with what `src/ai/surfaces.ts` resolves. Adding a page means adding one entry there and, if it needs more than the `global` surface, one line in `ROUTE_SURFACES`.

- `/[date]` - daily report. Section 2 leads at every width; entries carry inline +/- rating and expand their sources in place. Stats bar, day steppers, archive picker, live run status
- `/[date]/detail/[ids]` - the extractions behind one entry; the shareable deep link and the no-JS fallback for the inline expansion
- `/[date]/triage` - everything that arrived on that run and where it stopped: dropped at ingest, never extracted, dropped at the relevance gate, seen by synthesis and passed over, or cited. Filter chips per outcome plus a search; linked from the report's "filtered" figure
- `/sources` - source quality dashboard (trust scores, include rates, enable/disable)
- `/sources/[name]` - every delivery from one source and what extraction made of it
- `/feedback` - the item-level rating log behind the per-source totals
- `/entities` - entity graph explorer (filterable table)
- `/entities/[id]` - one entity: relations as an adjacency list, appearances as a timeline
- `/topics` - `active_topics`, with resolve and archive. Curation only: no skill may write this table
- `/contacts` - the sender directory. Edits go through `recordCorrection`, so they behave exactly as the assistant's do
- `/notes` - notes management: click-to-edit content, inline scope and expiry, search, sort, trash with restore, per-revision history with revert, bulk actions, undo on delete. System notes are editable too; provenance stays visible via `created_by` / `updated_by`
- `/rules` - `standing_context` CRUD, with a preview of the block as the Section 2 prompt receives it
- `/context-builder` - the harvested context document, standing rules, active corrections (with revert), and run controls
- `/skills` - the pending high-risk approval queue, the registry editor, and the execution log
- `/prompts` - prompt version management: diff against whatever is running for that section, activate, delete
- `/runs` - `pipeline_runs` history with duration and cost trends and the per-attempt error log
- `/questions` - pending question gate sessions
- `/chat` - the assistant full screen: the same `Panel` component the floating widget uses, plus the conversation list and the active corrections. Shares one live conversation with the widget

The **floating assistant** is mounted once in `+layout.svelte`, so it is reachable from every page and a turn survives navigation. Each page declares what it is showing with `setPageContext()` (`$lib/assistant/state.svelte`); the `focus` list hands the model real ids for the rows on screen. Turns stream over SSE (`POST /api/assistant/chat`), tool calls appear as they execute, and a turn that wrote something triggers `invalidateAll()` plus a highlight on the changed rows. It is hidden on `/chat`, which is the same thing full screen, and below `sm`, where the bottom bar's Chat tab replaces it.

**Dashboard conventions.** Pages are wrapped in `<Page size="read|app|form">`, which owns the container width and the responsive padding - there are three widths and one padding rule. Dates and numbers go through `$lib/format.ts`, DB enum values through `$lib/labels.ts`, cost through `$lib/pricing.ts`. Every `{@html}` goes through `renderMarkdown()` in `$lib/markdown.ts`; nothing else may call `marked`. UI language is English throughout, including the assistant's surface hints, and the palette is dark-only, with `dashboard/scripts/contrast.ts` enforcing the contrast floor on every check. The phone is the primary target: a change is checked at 390×844 on a real device before it counts as done, and a desktop viewport resized narrow is not that check. `dashboard/static/icons/icon.svg` is the single source for the header logo, the favicon and the PWA icon set, so editing it means regenerating the PNGs beside it. The phone is the primary target (decision 6): a change is checked at 390×844 before it counts as done, and a desktop viewport resized narrow is not that check.

## Cron schedule (all `Europe/Berlin`)

- Daily pipeline: configurable via `PIPELINE_RUN_TIME` env var (default 06:30)
- Implicit feedback: 22:00 daily
- Weekly source quality scoring: Sunday 23:00
- Weekly review conversation: Sunday 20:00
- Weekly meta-run (analytics + prompt diff): Sunday 23:30
- Entity graph pruning: Sunday 02:00
- Context Builder update run: 1st of the month, 03:00

Every one of these is a `pidra-<job>` systemd timer on pronix, defined in `hosts/pronix/pidra.nix` in the nixos flake, and runs `bun run src/job.ts <job>`. Adding a scheduled job means one entry in `JOBS` (`src/job.ts`) and one in `jobs` (`pidra.nix`), plus a line here.

## Skills

Skills are TypeScript modules in `/skills/`, auto-discovered on server start. The bridge runs on `localhost:4000` (never internet-exposed).

Risk levels:
- `low` - auto-execute immediately
- `medium` - execute with prominent log entry
- `high` - inserted as `pending` in `skill_executions`, requires manual confirmation
- `critical` - always rejected; never auto-execute

Current skills: `write_note`, `update_note`, `delete_note`, `restore_note`, `list_notes`, `read_report`, `run_web_search`, `add_todo_item`, `complete_todo_item`, `add_calendar_event`, `read_context` (all low), `create_file`, `send_email`, `send_mail`, `revise_context`, `revert_context_revision`, `set_source_active`, `propose_prompt_version`, `open_project_in_editor` (all medium).

All skill calls - from the REST bridge, the pipeline and the chat alike - go through `executeSkill()` in `src/skills/execute.ts`, which owns the risk gating, the surface policy and the `skill_executions` audit log. Never call `skill.execute()` directly from a new caller.

`Skill.execute(params, ctx)` receives a `SkillContext`: the `skill_executions` row id, who triggered it, the conversation, and the actor (`user | chat | system`) a write is attributed to. That is what puts provenance on a `note_revisions` row or a `context_corrections` row without the chat having to inject parameters.

The `/chat` loop (`src/ai/chat.ts`) exposes the whole registry as tools automatically, so a new skill in `skills/` is usable from the chat with no change there.

## Concurrency

Phase 2 (extraction): `CONCURRENCY = 4` workers in `phase2-extract.ts`. It is an API concurrency limit, not a GPU one - extraction has run on `gpt-5.6-luna` since the local Ollama path was removed, so raising it trades rate-limit risk against wall-clock, not VRAM.

Phase 3 (context assembly + web search): runs in parallel with Phase 2.

Section 1 synthesis never waits for the question gate. Section 2 blocks for up to 45 minutes.

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

## Privacy

Never use real personal information in code, comments, or examples - no real email addresses, names, phone numbers, or other PII. Use placeholders like `user@example.com` instead.

## What to build next

`TODO.md` holds the open items and nothing else - closed entries are removed rather than struck through, so anything still listed there is still work. Keep it that way.

Phases 0-6 are complete, and since 2026-09-12 the chain runs unattended end to end: all 16 ingest sources healthy, both sections synthesised, the push notification delivered. The Context Builder has had one full harvest plus update runs and now re-harvests monthly on pronix. The dashboard redesign was executed on 2026-09-12, the real-device pass included, and its plan document was deleted on completion. The conventions it settled live in the Dashboard conventions block above; git history holds the rest.

The thing that most wants doing: **running the pipeline against real newsletters for a few days** to tune the extraction prompts, which have never been judged on more than a single day's material.

## What not to build (yet)

- Phase 7 passive context sources (Keep as daily pipeline source, chat history, diary) - only after Phase 6 is stable and the core pipeline has run for 2+ weeks.
- Slots 4 and 5 of the web search module - only after day 60
- Any `critical`-risk skills. They are planned (2026-09-10) but blocked on two designs first: per-call explicit approval from the owner, and a real sequential agentic loop for skill use rather than one-shot batches. Until both are written down and built, `executeSkill()` keeps rejecting the tier outright.
- Netzpolitik.org as a 33rd source - declined 2026-09-10, no 30-day re-evaluation. 32 sources is already past the point where a marginal source dilutes more than it adds.

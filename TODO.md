# PIDRA - TODO

Phases follow the roadmap in `MORNING_BRIEFING_PLAN.md`. Phases 0-6 are complete. Context Builder implementation is complete (pending migration 0007 + Ollama/gkeepapi setup).

## Now

- ~~**[INFRA]** Apply migration 0007~~ (verified applied on pronix: `data` column + `cb_indexed_source_item` unique index present)
- ~~**[INFRA]** Set up Ollama on this machine + pull `hf.co/empero-ai/Qwen3.8-9B-GGUF:Q6_K`~~
- ~~**[INFRA]** gkeepapi one-time auth~~
- ~~**[FEATURE]** Context Builder: full first run - pre-seeds `entities`, `contacts`, `standing_context`~~ (2026-09-10: extraction moved off Ollama to `gpt-5.6-luna`; `entities`, `contacts` and `standing_context` all seeded)
- ~~**[DECISION]** `contacts` seeds only `importance != low`, which yielded 6 rows from 1432 emails - the `batch-contacts` heuristic (2+ high, or 3+ medium) is probably too strict for a first seed~~ (2026-09-10: not a threshold bug. `contacts` is an email sender directory, not a social graph; 6 rows is correct and no messaging platform will be ingested to grow it. See `CONTEXT_AND_DECISIONS.md §8`)
- ~~**[DECISION]** Entity graph has ~2900 nodes with `mention_count = 0` from the seed, including dates and one-off nouns. Decide whether the Sunday pruning job should sweep never-mentioned seeds or whether they should never have been inserted~~ (2026-09-10: decided, **no special sweep**. The seeds are unreachable by every cleanup path because `last_mentioned` is NULL, not because of a policy gap: `markDormantEntities` (`phase6-memory.ts:250`) and both steps of `entity-pruning.ts` compare against it, and `NULL < date` is never TRUE. The archive step additionally requires `importance = 'low'`, which nothing in the codebase ever sets. Once `last_mentioned` is real the seeds age out through the normal dormant → archived → deleted path; a `mention_count = 0` sweep would paper over the NULL bug and also wipe fresh seeds from each monthly CB run before the daily pipeline ever saw them. Fix the seed and the predicates instead, per the four items below)
- ~~**[FEATURE]** A way to correct Context Builder mistakes by talking to an AI, which fixes the analysis and the standing context~~ (2026-09-10: `/chat` on the dashboard, driven by `revise_context` / `revert_context_revision` / `read_context`. Corrections are an append-only layer in `context_corrections` that outranks the harvest in both synthesis prompts; the document and existing standing rules are never rewritten. Plan and reasoning in `CONTEXT_REVISION_PLAN.md`)
- **[INFRA]** Walk the first Context Builder output through `/chat` and fix the relationship errors it made (a girlfriend recorded as a friend, a family member recorded as a girlfriend)
- **[DECISION]** Whether a Context Builder update run should read `context_corrections` as a synthesis input, so a rebuilt document stops repeating a mistake the user already corrected. Parked until the layer has real content - the alternative is that corrections simply keep outranking the document forever, which is also fine
- ~~**[FEATURE]** Seed `entities.mention_count` with real corpus frequency and `last_mentioned` with the entity's last appearance date, instead of `0` and NULL~~ (2026-09-10: `seedEntities` now counts mentions per source item, deduped within an item, and derives `first_seen`/`last_mentioned` from the email dates. Notes contribute frequency but carry no date, so they never move `last_mentioned`. Existing rows still `onConflictDoNothing`: from the first daily run onwards the pipeline owns the live count)
- ~~**[FEATURE]** Narrow insert guard in `db-writer.ts` for dates and pure numbers~~ (2026-09-10: `isJunkEntityName`, checked against all 3485 live rows - catches 17, all genuine junk, no false positives. The month alternation is spelled out in full on purpose: `mar[a-z]*` swallowed Martin, Markus and Marriott, `jan[a-z]*` swallowed Jannik, `apr[a-z]*` swallowed apricot. Every date branch requires a digit, so a bare month name survives)
- ~~**[BUG]** Entity cleanup silently skips every row with `last_mentioned IS NULL`~~ (2026-09-10: all three predicates are `(last_mentioned IS NULL OR last_mentioned < threshold)` now. The unsatisfiable `importance = 'low'` in the archive step became `importance IS DISTINCT FROM 'high'`, which keeps the protective intent - never archive an entity the user cares about - while actually being reachable, since nothing ever writes `'low'`. `mention_count` is COALESCEd in the delete step for the same reason)
- ~~**[INFRA]** One-shot delete of the existing 3428 `mention_count = 0` entities~~ (2026-09-10: done. The population was exactly the seed - 3428 = `mention_count = 0` = `last_mentioned IS NULL` = both, out of 3485 - and it touched no `entity_relations` rows, so the 57 entities the pipeline has seen came through untouched. 22 of them already clear phase 3's `mention_count >= 3` promotion threshold. The next Context Builder run recreates the useful ones with real counts)
- **[BUG]** `<!--refs:-->` anchors are not validated, so dead "Mehr dazu" deep links ship in the report. Measured on the first full run: 26 distinct refs, 1 malformed UUID (model transcription slip), 2 well-formed but pointing at no row, so 3 of 26 links were dead. ~~Fixed in `phase6-memory.ts` via `resolveReportRefs`~~ (2026-09-10: repairs a one-character slip when exactly one real id from the run is within a single edit, drops anything else, and rewrites the block so the markdown never carries an unresolvable id). Still open: the existing 2026-09-10 report was written before this and keeps its 3 dead links until the next run
- ~~**[BUG]** `included_in_report` was a dead column: written only as `false` at three sites in `phase2-extract.ts`, read by nothing, while `writeSourceDailyScores` derived the include rate from an `effective_relevance >= 3` proxy~~ (2026-09-10: Phase 6 now sets it from the resolved report refs, so source trust is calibrated on what actually reached the user. `daily_reports.items_included` uses the same figure instead of the newsletter count the caller passed. If a run resolves no refs at all, scoring falls back to the old proxy for the day rather than punishing every source for a synthesis formatting failure)
- ~~**[BUG]** `prompt_versions` is never read at runtime~~ (2026-09-10: `src/ai/active-prompts.ts` now resolves each of the five sections to either the active DB row or the constant in `src/ai/prompts.ts`. Phase 5 resolves per section at synthesis time, Phase 2 resolves its three extraction prompts once per run - per item would have meant 3 lookups × 300 items - and per-account instructions are still prepended on top of whichever `personal_classification` prompt wins. Resolution is deliberately uncached and never happens at import time, so an activation lands on the next run instead of the next process restart. Verified against the live table: empty → all five `code`, one active `section1` row → `db v1` for that section only, an unknown `section` value is ignored rather than inventing a stage. The weekly meta-run now reviews the effective prompts too, so it stops returning `null` while the table is empty, and `/prompts` shows the code baseline as an "in Benutzung" card so a section with no versions is no longer an empty page)
- **[FEATURE]** `batchContacts` computes `emailCount`, `categories` and `actionCount` per contact and discards all three, the same shape of loss as the entity frequency above. `contacts` has nowhere to put them today, so this needs a column or two first
- **[PERF]** The daily Google Tasks snapshot writes one `raw_items` row per open task per day (171 today, roughly 62k a year), because `google.ts:116` puts `runDate` in the dedup key. Nothing reads a past day's snapshot. Either key on the task id plus its `updated` timestamp, or age the snapshots out
- **[DECISION]** Every `jsonb` column is double-encoded: Drizzle's `jsonb` type pre-stringifies (right for node-postgres) and the Bun SQL driver serialises that string again, so columns hold a JSON *string* scalar (`jsonb_typeof` = `string`, verified on `extractions.extracted_json` for all 147 rows and on `question_gate_sessions.questions`). Drizzle's own reads parse it back, so the pipeline is unaffected, but raw SQL is not: `jsonb_array_length`, `->`, `@>` and GIN indexing all fail or misbehave. Readers are patched defensively (`dashboard/src/lib/jsonb.ts`); decide whether to normalise the storage to real jsonb, which needs a custom Drizzle type plus a migration of all 7 jsonb columns. Blocks `report_json` (`DASHBOARD_PLAN.md §4 C1`) and keyword search (D8), both of which need real jsonb operators
- **[FEATURE]** Context Builder: set up monthly update run cadence (cron or manual)
- **[INFRA]** Test daily pipeline with real newsletters for 3 days, tune extraction prompts
- **[PERF]** Context Builder: fetch email accounts concurrently in `run.ts` - the mail fetch is now the whole runtime, and each account is an independent IMAP connection
- **[INFRA]** `DATABASE_URL` points at `192.168.10.85`, only reachable on the LAN. For runs from outside, tunnel first: `ssh -N -L 15432:127.0.0.1:5432 ros` and point `DATABASE_URL` at `127.0.0.1:15432`
- **[FEATURE]** Begin adding medium-risk skills gradually (`create_file`, `open_project_in_editor`)

## Soon

**Phase 7 - Google Keep:**
- **[FEATURE]** Bulk initial import (handled by Context Builder - run CB first)
- **[FEATURE]** Build Keep notes Ollama indexer for ongoing daily delta (reuses `context_builder_indexed_items` skip-set)
- **[FEATURE]** Phase 3 entity → Keep lookup and context injection
- **[INFRA]** Create `keep_notes` and `keep_index` tables for pipeline use

**Phase 7 - AI Chat History:**
- **[DECISION]** Document chat history DB schema (tables, timestamps, session IDs)
- **[FEATURE]** Connect to chat history DB, implement nightly Ollama extraction job (03:00)
- **[FEATURE]** Build `chat_signals` table + integration with relevance calibration
- **[FEATURE]** Implement project signal injection into synthesis prompts
- **[FEATURE]** Add user toggle in dashboard to enable/disable

**Phase 7 - Diary:**
- **[DECISION]** Decide on canonical diary format (Markdown files, SQLite, or Obsidian vault)
- **[FEATURE]** Implement diary reader module (format-specific)
- **[FEATURE]** Build weekly Ollama personal context extraction job (Sunday, abstract only)
- **[FEATURE]** Personal context block injection into Section 2 prompt
- **[FEATURE]** Personal context viewer/editor in dashboard
- **[INFRA]** Create `personal_context` table

**Open Decisions - Pre-seed (before first run):**
- **[DECISION]** Family email addresses - verify Context Builder output, add names/relationships it couldn't infer
- **[DECISION]** Client email domains (`hacibaba`, `zigarren-puro`, etc.) - verify `priority: high` is set post-CB run
- **[DECISION]** Default Google Tasks list for system-created items - confirm "To-Do Now" or "Work"
- **[DECISION]** Daily Life Rules - review `standing_context` table after first CB run, correct any misextracted rules
- **[DECISION]** Recurring financial commitments - supplement with any not appearing in email (cash payments, rent)
- **[DECISION]** University details - name, program, current semester (add manually or as `standing_context` entry)
- **[DECISION]** China trip dates - add to Google Calendar if not already there
- **[DECISION]** Preferred wake-up/read time - adjust cron from default 06:30

**Open Decisions - At 30-day mark:**
- **[DECISION]** Evaluate Netzpolitik.org as source #33 (EU digital regulation)
- **[DECISION]** Evaluate web search quality - upgrade from Brave to Tavily or Exa if insufficient
- **[DECISION]** Before first CB run: review "Shower ideas" Keep category manually for high-importance entities

**Open Decisions - Infrastructure:**
- **[DECISION]** Diary format and location (must decide before implementing diary reader)
- **[INFRA]** Email self-hosting migration (Postfix/Dovecot or Stalwart) - not a blocker, decide after system is stable

## Later

**Phase 8 - Smart Reply** (only after all prior phases complete and stable):

- **[FEATURE]** Add `reply_monitoring: boolean` to per-address config block
- **[FEATURE]** During Ollama personal email classification: add dedicated pass to decide if mail deserves a reply; write flag on `raw_items`/`extractions`
- **[FEATURE]** "Mails worth replying to" panel in dashboard (collapsible, sender + subject + 1-line summary)
- **[FEATURE]** Reply form: Option A - "Later reply" template with delay dropdown (2h/4h/8h/24h/2d/3d/1w), AI generates polite placeholder, user previews before sending via SMTP
- **[FEATURE]** Reply form: Option B - AI-drafted full reply (Sonnet, all context: contact history, active topics, entity graph), editable textarea, Regenerate button, sends via SMTP
- **[INFRA]** `sent_replies` table (message_id, raw_item_id, reply_type, sent_at, body_hash) for audit and dedup
- **[DECISION]** GitHub activity integration (webhook or polling for PR reviews, CI failures) - evaluate after system is self-hosted and stable

**Dashboard redesign** (full plan in `DASHBOARD_PLAN.md`, decisions settled 2026-09-10):

- **[FEATURE]** Phases A-E per `DASHBOARD_PLAN.md §7` - design foundation, app shell, report reading experience, missing pages, UX polish
- **[FEATURE]** Phase 5 emits `daily_reports.report_json` alongside the markdown (`DASHBOARD_PLAN.md §4 C1`) - the one pipeline change the dashboard plan owns
- **[DECISION]** Semantic search over the archive (pgvector + local embeddings, hybrid ranking) - parked, full reasoning in `DASHBOARD_PLAN.md §10`. Blocked on amending the "No vector stores" rule in `CLAUDE.md` and `CONTEXT_AND_DECISIONS.md` first. Evaluate after keyword search (D8) ships and the archive passes ~60 reports.

---

## Done

- ~~**[INFRA]** Set up Postgres database, run schema migrations with DrizzleORM~~
- ~~**[INFRA]** Configure Bun project structure~~
- ~~**[INFRA]** Test IMAP connection to Netcup server~~
- ~~**[INFRA]** Configure Google Calendar API credentials (OAuth 2.0)~~
- ~~**[INFRA]** Configure Google Tasks API credentials~~
- ~~**[INFRA]** Set up SMS webhook endpoint (`POST /webhook/sms`)~~
- ~~**[FEATURE]** RSS feed audit: 32 newsletters, build `rss_feeds` config~~
- ~~**[FEATURE]** Phase 1: IMAP, Google Calendar, Google Tasks, SMS ingestion~~
- ~~**[FEATURE]** HTML stripping and Message-ID dedup for emails~~
- ~~**[FEATURE]** Per-account sender ignore list~~
- ~~**[FEATURE]** RSS polling for newsletters that support it~~
- ~~**[FEATURE]** Ollama newsletter, entity, and personal email classification prompts~~
- ~~**[FEATURE]** Phase 3 context assembly: active topics, entity lookup, novelty scoring~~
- ~~**[FEATURE]** Effective relevance calculation + volume signal~~
- ~~**[FEATURE]** Section 1 and Section 2 Sonnet synthesis calls~~
- ~~**[FEATURE]** Phase 6 memory writes (parse `<!--SYSTEM-->` blocks)~~
- ~~**[FEATURE]** Minimal SvelteKit dashboard: display today's report~~
- ~~**[FEATURE]** Question gate: batching, API endpoints, 45-min timeout~~
- ~~**[FEATURE]** Section 1 / Section 2 parallelization during gate wait~~
- ~~**[FEATURE]** PWA + Web Push notifications~~
- ~~**[FEATURE]** Contacts table and contact-learning loop~~
- ~~**[INFRA]** Bun cron for automated daily run (default 06:30)~~
- ~~**[FEATURE]** Entity knowledge graph (extraction → upsert pipeline)~~
- ~~**[FEATURE]** Entity context injection into synthesis payload~~
- ~~**[FEATURE]** Source quality table + weekly scoring job~~
- ~~**[FEATURE]** Implicit behavioral signals feedback~~
- ~~**[FEATURE]** Explicit +/- rating UI in dashboard~~
- ~~**[FEATURE]** Dormant entity detection~~
- ~~**[INFRA]** Brave Search API integration (2,000 calls/month free)~~
- ~~**[FEATURE]** Web search Slots 1-3 (top topic deep-dive, dormant entity monitor, reputation monitoring)~~
- ~~**[FEATURE]** Claude Code skills bridge: local REST API + TypeScript skill loader~~
- ~~**[FEATURE]** Starting skills: write_note, delete_note, run_web_search, add_todo_item, complete_todo_item, add_calendar_event~~
- ~~**[FEATURE]** Skill suggestions from Sonnet `<!--SYSTEM-->` output~~
- ~~**[FEATURE]** Skill execution log in dashboard~~
- ~~**[FEATURE]** Weekly meta-run analytics + prompt diff generation~~
- ~~**[FEATURE]** Prompt approval flow (`prompt_versions` table)~~
- ~~**[FEATURE]** Entity graph pruning~~
- ~~**[FEATURE]** Weekly review conversation~~
- ~~**[FEATURE]** Source quality dashboard, entity graph explorer, notes management UI, error monitoring, performance logging~~
- ~~**[INFRA]** Context Builder: sub-project scaffolding and DB migrations~~
- ~~**[DECISION]** Keep API approach: gkeepapi (Python subprocess) only~~
- ~~**[DECISION]** Web search API: Brave Search (free tier)~~

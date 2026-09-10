# PIDRA - TODO

Phases follow the roadmap in `MORNING_BRIEFING_PLAN.md`. Phases 0-6 are complete. The Context Builder is complete and has had one full run (2026-09-10). Items the owner handles directly, above all corrections to the harvested context, live in `/chat` rather than here.

## Now

- ~~**[FEATURE]** Make `/notes` directly editable~~ (2026-09-10: click-to-edit content, inline scope and expiry, search, sort, trash with restore, per-revision history with revert, bulk scope and delete, undo toast. `src/notes/store.ts` is the single writer: every mutation appends the pre-change state to `note_revisions`, deletes are soft, and `phase3-context` plus `search/slots` filter `deleted_at IS NULL` so a deleted note stops steering the briefing the same second. The page reads Postgres directly and writes through the bridge, so it still renders when the bridge is down. Migration `0010_notes_editable.sql`, applied on pronix)
- ~~**[FEATURE]** Floating AI assistant on every page, scoped per page, reports excluded~~ (2026-09-10: `src/ai/surfaces.ts` maps each route to a surface with its own skill list, prompt fragment and example sentences; `executeSkill` enforces it before the risk level and logs rejections, and the chat loop only offers that surface's tools. Turns stream over SSE with tool calls appearing as they execute, and a turn that wrote something triggers `invalidateAll()` plus a highlight on the changed rows. `/chat` is the same `Panel` component full screen and shares the live conversation. Verified end to end against the real model: an edit on the notes surface went through, and "streich den Absatz aus dem Report" was refused with the alternatives offered. Plan in `ASSISTANT_PLAN.md`)
- ~~**[BUG]** Bun closed the assistant's event stream after 10 seconds~~ (2026-09-10: `Bun.serve`'s default `idleTimeout` cut a turn in half - a flex-tier call goes quiet for minutes between tool calls. `idleTimeout: 0` on the bridge, plus a 15 s SSE heartbeat so nothing between the bridge and the browser considers the connection dead either)
- **[INFRA]** Click through the floating assistant in a browser once: keyboard shortcut, mobile sheet, the highlight after a write, and the panel surviving navigation mid-turn. All of it is type-checked and the server side is verified by curl, but none of it has been exercised by hand
- **[FEATURE]** Soft-deleted notes are never purged. The trash view makes them visible and the volume is tiny, so this is deliberate for now - if it ever matters, the Sunday 02:00 pruning cron is the place to age them out
- ~~**[INFRA]** Apply migration 0007~~ (verified applied on pronix: `data` column + `cb_indexed_source_item` unique index present)
- ~~**[INFRA]** Set up Ollama on this machine + pull `hf.co/empero-ai/Qwen3.8-9B-GGUF:Q6_K`~~
- ~~**[INFRA]** gkeepapi one-time auth~~
- ~~**[FEATURE]** Context Builder: full first run - pre-seeds `entities`, `contacts`, `standing_context`~~ (2026-09-10: extraction moved off Ollama to `gpt-5.6-luna`; `entities`, `contacts` and `standing_context` all seeded)
- ~~**[DECISION]** `contacts` seeds only `importance != low`, which yielded 6 rows from 1432 emails - the `batch-contacts` heuristic (2+ high, or 3+ medium) is probably too strict for a first seed~~ (2026-09-10: not a threshold bug. `contacts` is an email sender directory, not a social graph; 6 rows is correct and no messaging platform will be ingested to grow it. See `CONTEXT_AND_DECISIONS.md §8`)
- ~~**[DECISION]** Entity graph has ~2900 nodes with `mention_count = 0` from the seed, including dates and one-off nouns. Decide whether the Sunday pruning job should sweep never-mentioned seeds or whether they should never have been inserted~~ (2026-09-10: decided, **no special sweep**. The seeds are unreachable by every cleanup path because `last_mentioned` is NULL, not because of a policy gap: `markDormantEntities` (`phase6-memory.ts:250`) and both steps of `entity-pruning.ts` compare against it, and `NULL < date` is never TRUE. The archive step additionally requires `importance = 'low'`, which nothing in the codebase ever sets. Once `last_mentioned` is real the seeds age out through the normal dormant → archived → deleted path; a `mention_count = 0` sweep would paper over the NULL bug and also wipe fresh seeds from each monthly CB run before the daily pipeline ever saw them. Fix the seed and the predicates instead, per the four items below)
- ~~**[FEATURE]** A way to correct Context Builder mistakes by talking to an AI, which fixes the analysis and the standing context~~ (2026-09-10: `/chat` on the dashboard, driven by `revise_context` / `revert_context_revision` / `read_context`. Corrections are an append-only layer in `context_corrections` that outranks the harvest in both synthesis prompts; the document and existing standing rules are never rewritten. Plan and reasoning in `CONTEXT_REVISION_PLAN.md`)
- **[FEATURE]** Feed active `context_corrections` into the Context Builder's update run as read-only known-correct facts (decided 2026-09-10, no longer parked). The injection point is `synthesizePatch` in `context-builder/pipeline/synthesize.ts`: an update run never re-reads an indexed email, so it cannot re-derive a corrected mistake from the same mail, but it does hand the *previous document* to the patch prompt verbatim, and that document still contains the wrong text. Corrections must therefore outrank `existingContext` in that prompt. The run stays forbidden from writing, editing or deleting a correction
- ~~**[FEATURE]** Seed `entities.mention_count` with real corpus frequency and `last_mentioned` with the entity's last appearance date, instead of `0` and NULL~~ (2026-09-10: `seedEntities` now counts mentions per source item, deduped within an item, and derives `first_seen`/`last_mentioned` from the email dates. Notes contribute frequency but carry no date, so they never move `last_mentioned`. Existing rows still `onConflictDoNothing`: from the first daily run onwards the pipeline owns the live count)
- ~~**[FEATURE]** Narrow insert guard in `db-writer.ts` for dates and pure numbers~~ (2026-09-10: `isJunkEntityName`, checked against all 3485 live rows - catches 17, all genuine junk, no false positives. The month alternation is spelled out in full on purpose: `mar[a-z]*` swallowed Martin, Markus and Marriott, `jan[a-z]*` swallowed Jannik, `apr[a-z]*` swallowed apricot. Every date branch requires a digit, so a bare month name survives)
- ~~**[BUG]** Entity cleanup silently skips every row with `last_mentioned IS NULL`~~ (2026-09-10: all three predicates are `(last_mentioned IS NULL OR last_mentioned < threshold)` now. The unsatisfiable `importance = 'low'` in the archive step became `importance IS DISTINCT FROM 'high'`, which keeps the protective intent - never archive an entity the user cares about - while actually being reachable, since nothing ever writes `'low'`. `mention_count` is COALESCEd in the delete step for the same reason)
- ~~**[INFRA]** One-shot delete of the existing 3428 `mention_count = 0` entities~~ (2026-09-10: done. The population was exactly the seed - 3428 = `mention_count = 0` = `last_mentioned IS NULL` = both, out of 3485 - and it touched no `entity_relations` rows, so the 57 entities the pipeline has seen came through untouched. 22 of them already clear phase 3's `mention_count >= 3` promotion threshold. The next Context Builder run recreates the useful ones with real counts)
- **[BUG]** `<!--refs:-->` anchors are not validated, so dead "Mehr dazu" deep links ship in the report. Measured on the first full run: 26 distinct refs, 1 malformed UUID (model transcription slip), 2 well-formed but pointing at no row, so 3 of 26 links were dead. ~~Fixed in `phase6-memory.ts` via `resolveReportRefs`~~ (2026-09-10: repairs a one-character slip when exactly one real id from the run is within a single edit, drops anything else, and rewrites the block so the markdown never carries an unresolvable id). Still open: the existing 2026-09-10 report was written before this and keeps its 3 dead links until the next run
- ~~**[BUG]** `included_in_report` was a dead column: written only as `false` at three sites in `phase2-extract.ts`, read by nothing, while `writeSourceDailyScores` derived the include rate from an `effective_relevance >= 3` proxy~~ (2026-09-10: Phase 6 now sets it from the resolved report refs, so source trust is calibrated on what actually reached the user. `daily_reports.items_included` uses the same figure instead of the newsletter count the caller passed. If a run resolves no refs at all, scoring falls back to the old proxy for the day rather than punishing every source for a synthesis formatting failure)
- ~~**[BUG]** `prompt_versions` is never read at runtime~~ (2026-09-10: `src/ai/active-prompts.ts` now resolves each of the five sections to either the active DB row or the constant in `src/ai/prompts.ts`. Phase 5 resolves per section at synthesis time, Phase 2 resolves its three extraction prompts once per run - per item would have meant 3 lookups × 300 items - and per-account instructions are still prepended on top of whichever `personal_classification` prompt wins. Resolution is deliberately uncached and never happens at import time, so an activation lands on the next run instead of the next process restart. Verified against the live table: empty → all five `code`, one active `section1` row → `db v1` for that section only, an unknown `section` value is ignored rather than inventing a stage. The weekly meta-run now reviews the effective prompts too, so it stops returning `null` while the table is empty, and `/prompts` shows the code baseline as an "in Benutzung" card so a section with no versions is no longer an empty page)
- **[FEATURE]** `batchContacts` computes `emailCount`, `categories` and `actionCount` per contact and discards all three, the same shape of loss as the entity frequency above. `contacts` has nowhere to put them today, so this needs a column or two first
- **[PERF]** The daily Google Tasks snapshot writes one `raw_items` row per open task per day (171 today, roughly 62k a year), because `google.ts:116` puts `runDate` in the dedup key. Nothing reads a past day's snapshot. Either key on the task id plus its `updated` timestamp, or age the snapshots out
- ~~**[BUG]** Every `jsonb` column is double-encoded, so `jsonb_array_length`, `->`, `@>` and GIN indexing all fail or misbehave~~ (2026-09-10: fixed at the writer and the data. `src/db/jsonb.ts` replaces the pg-core type with one whose `toDriver` hands the value over untouched, so the Bun driver serialises it exactly once - measured: raw object → `jsonb_typeof = object`, pre-stringified → `string`. `schema.ts` changed by two lines, the import, since the custom type has the same signature and every column declaration is unchanged. 1,988 values across 5 columns converted on pronix, verified: `object=1838` (`context_builder_indexed_items.data`), `object=147` (`extractions.extracted_json`), `object=1`, `array=1`, `array=1`, and no `string` left anywhere. `->>`, `?`, `@>` and `jsonb_array_length` all confirmed working on the real rows afterwards, and `jsonb_array_length(questions)` now returns 1 where the dashboard used to render "183 questions pending". `fromDriver` still parses a string, so any row a stray raw-SQL writer produces keeps reading. `migrations/0011_jsonb_normalise.sql` records the equivalent SQL. One row in `context_builder_indexed_items.data` carried a lone UTF-16 surrogate from content truncated mid-emoji, which Postgres accepts inside a string scalar but rejects as an escape in real jsonb, so it was repaired to U+FFFD in JS; the truncation that produced it is upstream and still unfixed. Unblocks `report_json` (`DASHBOARD_PLAN.md §4 C1`) and keyword search (D8))
- **[FEATURE]** Default Google Tasks list for system-created items: use "To-Do Now" (decided 2026-09-10), configurable via env var rather than hardcoded. System items come from email deadlines and are time-sensitive, so they belong in the list that is checked daily, not in the project backlog
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

**Phase 7 - AI Chat History** (decided 2026-09-10: sequence this track *last* of the three Phase 7 sources. Keep and diary are denser signal for less privacy surface, so they go first and this one starts only when they are stable):
- **[INFRA]** Document chat history DB schema (tables, timestamps, session IDs) - when the track starts, not before
- **[FEATURE]** Connect to chat history DB, implement nightly Ollama extraction job (03:00)
- **[FEATURE]** Build `chat_signals` table + integration with relevance calibration
- **[FEATURE]** Implement project signal injection into synthesis prompts
- **[FEATURE]** Add user toggle in dashboard to enable/disable

**Phase 7 - Diary** (format decided 2026-09-10: a plain directory of Markdown files, one file per day, `YYYY-MM-DD.md`. No Obsidian vault, no SQLite - no lock-in, trivially readable from Bun, and git gives versioning for free):
- **[FEATURE]** Implement diary reader module (directory scan + per-day Markdown parse)
- **[FEATURE]** Build weekly Ollama personal context extraction job (Sunday, abstract only)
- **[FEATURE]** Personal context block injection into Section 2 prompt
- **[FEATURE]** Personal context viewer/editor in dashboard
- **[INFRA]** Create `personal_context` table

**Open Decisions - At 30-day mark:**
- **[DECISION]** Evaluate web search quality - upgrade from Brave to Tavily or Exa if insufficient. Cost is not the constraint (3 slots/day is ~90 calls against a 2,000/month free tier), so the trigger is consistently thin slot 1 deep-dives, not quota

Content corrections about the owner (relationships, client domains, standing rules, commitments, university, trip dates) are not tracked here: they are made directly in `/chat`, where `context_corrections` records them with provenance.

## Later

**Phase 8 - Smart Reply** (only after all prior phases complete and stable):

- **[FEATURE]** Add `reply_monitoring: boolean` to per-address config block
- **[FEATURE]** During Ollama personal email classification: add dedicated pass to decide if mail deserves a reply; write flag on `raw_items`/`extractions`
- **[FEATURE]** "Mails worth replying to" panel in dashboard (collapsible, sender + subject + 1-line summary)
- **[FEATURE]** Reply form: Option A - "Later reply" template with delay dropdown (2h/4h/8h/24h/2d/3d/1w), AI generates polite placeholder, user previews before sending via SMTP
- **[FEATURE]** Reply form: Option B - AI-drafted full reply (Sonnet, all context: contact history, active topics, entity graph), editable textarea, Regenerate button, sends via SMTP
- **[INFRA]** `sent_replies` table (message_id, raw_item_id, reply_type, sent_at, body_hash) for audit and dedup
- **[FEATURE]** GitHub activity integration (PR reviews, CI failures) by **polling, not webhooks** (decided 2026-09-10). A webhook would mean public ingress; the skills bridge staying LAN-only is worth more than the latency saved. Not before the system is stable

**Skills - critical tier** (decided 2026-09-10: critical-risk skills *will* exist, contrary to the earlier blanket "never"):
- **[DECISION]** Design the approval model before any critical skill is written. Every single critical execution needs an explicit yes from the owner, per call, not a standing grant
- **[DECISION]** Design the execution model: skill use should run as a real agentic loop, sequential like Claude Code (act, observe the result, decide the next step), not one shot that fires a batch of calls. This affects `src/ai/chat.ts` and `executeSkill()`, so it needs a written plan of its own before implementation
- Until both are planned and built, `critical` stays "always rejected" in `executeSkill()`

**Email self-hosting** (decided 2026-09-10: not now):
- **[INFRA]** Revisit after ~60 days of stable runs. It puts deliverability and IMAP reliability under the one system that is meant to be trustworthy. When it happens: **Stalwart**, single binary, far less config surface than Postfix + Dovecot and a better fit for a NixOS module

**Dashboard redesign** (full plan in `DASHBOARD_PLAN.md`, decisions settled 2026-09-10):

- **[FEATURE]** Phases A-E per `DASHBOARD_PLAN.md §7` - design foundation, app shell, report reading experience, missing pages, UX polish
- **[FEATURE]** Phase 5 emits `daily_reports.report_json` alongside the markdown (`DASHBOARD_PLAN.md §4 C1`) - the one pipeline change the dashboard plan owns
- **[FEATURE]** Semantic search over the archive (pgvector + local embeddings, hybrid ranking), full design in `DASHBOARD_PLAN.md §10`. **A vector store is planned (decided 2026-09-10), but for the far future** - not a near-term concern and explicitly not part of any current phase. The old rule now reads "not yet", not "never" (`CLAUDE.md`, `CONTEXT_AND_DECISIONS.md §10`). Preconditions unchanged: keyword search (D8) ships first, archive past ~60 reports, and searches `tsvector` demonstrably fails.

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

# PIDRA - TODO

Phases follow the roadmap in `MORNING_BRIEFING_PLAN.md`. Phases 0-6 are complete. Context Builder implementation is complete (pending migration 0007 + Ollama/gkeepapi setup).

## Now

- ~~**[INFRA]** Apply migration 0007~~ (verified applied on pronix: `data` column + `cb_indexed_source_item` unique index present)
- ~~**[INFRA]** Set up Ollama on this machine + pull `hf.co/empero-ai/Qwen3.8-9B-GGUF:Q6_K`~~
- ~~**[INFRA]** gkeepapi one-time auth~~
- ~~**[FEATURE]** Context Builder: full first run - pre-seeds `entities`, `contacts`, `standing_context`~~ (2026-09-10: extraction moved off Ollama to `gpt-5.6-luna`; `entities`, `contacts` and `standing_context` all seeded)
- ~~**[DECISION]** `contacts` seeds only `importance != low`, which yielded 6 rows from 1432 emails - the `batch-contacts` heuristic (2+ high, or 3+ medium) is probably too strict for a first seed~~ (2026-09-10: not a threshold bug. `contacts` is an email sender directory, not a social graph; 6 rows is correct and no messaging platform will be ingested to grow it. See `CONTEXT_AND_DECISIONS.md §8`)
- ~~**[DECISION]** Entity graph has ~2900 nodes with `mention_count = 0` from the seed, including dates and one-off nouns. Decide whether the Sunday pruning job should sweep never-mentioned seeds or whether they should never have been inserted~~ (2026-09-10: decided, **no special sweep**. The seeds are unreachable by every cleanup path because `last_mentioned` is NULL, not because of a policy gap: `markDormantEntities` (`phase6-memory.ts:250`) and both steps of `entity-pruning.ts` compare against it, and `NULL < date` is never TRUE. The archive step additionally requires `importance = 'low'`, which nothing in the codebase ever sets. Once `last_mentioned` is real the seeds age out through the normal dormant → archived → deleted path; a `mention_count = 0` sweep would paper over the NULL bug and also wipe fresh seeds from each monthly CB run before the daily pipeline ever saw them. Fix the seed and the predicates instead, per the four items below)
- **[FEATURE]** Seed `entities.mention_count` with real corpus frequency and `last_mentioned` with the entity's last appearance date, instead of `0` and NULL. `db-writer.ts:64` dedupes names into `byKey` and discards a count the extractions already carry (same pattern as `batchContacts` dropping `emailCount`). This makes phase 3's existing `mentionCount >= 3` filter (`phase3-context.ts:134`) promote genuinely recurring entities on day one, which is the stated point of pre-seeding, and leaves one-off nouns invisible. No new policy anywhere
- **[FEATURE]** Narrow insert guard in `db-writer.ts` for dates and pure numbers, alongside the existing length checks. Not a general entity-shape regex: the extraction model judges that better. Keeps the monthly CB update run from re-injecting the same junk, so it lands before the cadence item below
- **[BUG]** Entity cleanup silently skips every row with `last_mentioned IS NULL`. Rewrite the predicates in `phase6-memory.ts:250` and both steps of `entity-pruning.ts` as `(last_mentioned IS NULL OR last_mentioned < threshold)`, or make the column NOT NULL. Fix or drop the unsatisfiable `importance = 'low'` condition in the archive step at the same time. Without this, any future insert that omits `last_mentioned` creates more permanently unprunable rows
- **[INFRA]** One-shot delete of the existing ~2900 `mention_count = 0` entities via a temp Bun script (`new SQL(DATABASE_URL)`, delete the script afterwards), once the seed fix is in. The next CB run recreates them with real counts. Verify first that the count matches `last_mentioned IS NULL`
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

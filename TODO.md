# PIDRA - TODO

Phases follow the roadmap in `MORNING_BRIEFING_PLAN.md`. Phases 0-6 are complete. Context Builder implementation is complete (pending migration 0007 + Ollama/gkeepapi setup).

## Now

- **[INFRA]** Apply migration 0007: run `bun run tmp-migrate-0007.ts` when pronix is reachable, then delete the file
- **[INFRA]** Set up Ollama on this machine + pull `qwen2.5:14b`
- **[INFRA]** gkeepapi one-time auth: `nix shell nixpkgs#python3Packages.gkeepapi -c python3 context-builder/scripts/keep-auth.py`
- **[FEATURE]** Context Builder: full first run - pre-seeds `entities`, `contacts`, `standing_context`
- **[FEATURE]** Context Builder: set up monthly update run cadence (cron or manual)
- **[INFRA]** Test pipeline with real newsletters for 3 days, tune Ollama prompts
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

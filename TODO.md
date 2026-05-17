# PIDRA — Build TODO

Phases follow the roadmap in `MORNING_BRIEFING_PLAN.md §22–23`. Work top-to-bottom within each phase before starting the next.

---

## Phase 0 — Infrastructure

- [ ] Set up Postgres database, run schema migrations with DrizzleORM
- [ ] Configure Bun project structure
- [ ] Set up Ollama with qwen2.5:14b (Q4_K_M quantization)
- [ ] Test IMAP connection to Netcup server
- [ ] Configure Google Calendar API credentials (OAuth 2.0)
- [ ] Configure Google Tasks API credentials
- [ ] Set up SMS webhook endpoint (`POST /webhook/sms`)
- [ ] Verify Claude Sonnet 4.6 API access
- [ ] RSS feed audit: for each of the 32 newsletters, check if an RSS feed exists. Build a `rss_feeds` config mapping `source_name → rss_url | null`. Newsletters with RSS skip IMAP (cleaner content, no HTML footers).

---

## Phase 1 — Core Pipeline

- [ ] Implement Phase 1 ingestion: IMAP + Calendar + Tasks + SMS
- [ ] Implement HTML stripping and Message-ID dedup for emails
- [ ] Implement RSS polling for newsletters that support it (run in parallel with IMAP)
- [ ] Implement Ollama newsletter extraction prompt (content pass)
- [ ] Implement Ollama entity extraction prompt (second pass, batched)
- [ ] Implement Ollama personal email classification prompt
- [ ] Implement Phase 3 context assembly: active topics, entity lookup, novelty scoring
- [ ] Implement effective relevance calculation + volume signal (light / normal / heavy)
- [ ] Implement Section 1 Sonnet synthesis call
- [ ] Implement Section 2 Sonnet synthesis call
- [ ] Implement Phase 6 memory writes (parse `<!--SYSTEM-->` blocks)
- [ ] Build minimal SvelteKit dashboard: display today's report
- [ ] Test with real newsletters for 3 days, tune Ollama prompts

---

## Phase 2 — Question Gate + Delivery

- [ ] Implement question gate: batching, question API endpoints, 45-min timeout behavior
- [ ] Implement Section 1 / Section 2 parallelization during gate wait
- [ ] Implement PWA + Web Push notifications in SvelteKit
- [ ] Implement contacts table and contact-learning loop (question → contacts write)
- [ ] Set up Bun cron for automated daily run (default: 06:30)

---

## Phase 3 — Memory and Compounding

- [ ] Implement entity knowledge graph (Ollama extraction → upsert pipeline)
- [ ] Implement entity context injection into Sonnet synthesis payload (trigger: mention_count ≥ 3)
- [ ] Implement source quality table + weekly scoring job (Bun, no AI)
- [ ] Implement feedback mechanism 1: implicit behavioral signals (calendar/todo cross-reference)
- [ ] Implement explicit +/- rating UI in SvelteKit dashboard
- [ ] Implement dormant entity detection + web search Slot 2 trigger

---

## Phase 4 — Web Search + Skills Bridge

- [ ] Choose web search API (start with Brave Search free tier — 2,000 calls/month)
- [ ] Abstract behind internal `POST /search` interface
- [ ] Implement Slot 1: top active topic deep-dive (always runs)
- [ ] Implement Slot 2: dormant high-importance entity monitor (conditional)
- [ ] Implement Slot 3: self/project reputation monitoring (daily, rotating targets)
- [ ] Build Claude Code skills bridge: local REST API + TypeScript skill loader (`/skills` dir)
- [ ] Implement starting skills (see below)
- [ ] Integrate skill suggestions from Sonnet `<!--SYSTEM-->` output
- [ ] Implement skill execution log in SvelteKit dashboard

### Starting skills

| Skill | Risk |
|---|---|
| `add_calendar_event` | low |
| `add_todo_item` | low |
| `complete_todo_item` | low |
| `write_note` | low |
| `delete_note` | low |
| `run_web_search` | low |
| `send_question` | low |
| `create_file` | medium |
| `open_project_in_editor` | medium |
| `run_terminal_command` (allowlist enforced) | high |
| `git_commit` | high |
| `restart_service` | high |
| `deploy_project` | critical |

---

## Phase 5 — Self-Improvement Loop

- [ ] Implement weekly meta-run analytics computation (Bun, no AI)
- [ ] Implement prompt diff generation (1 Sonnet call, Sunday evening)
- [ ] Implement prompt approval flow (question API + `prompt_versions` table)
- [ ] Implement entity graph pruning (Bun, weekly)
- [ ] Implement weekly review conversation (3 questions → Sonnet → notes writes)

---

## Phase 6 — Polish and Monitoring

- [ ] Source quality dashboard in SvelteKit (trust scores, include rates per source)
- [ ] Entity graph explorer (basic table view: name, type, mention count, status)
- [ ] Notes management UI (view, add, delete)
- [ ] Error monitoring: email fallback if daily run fails
- [ ] Performance logging: token usage, run times, source coverage per run
- [ ] Begin adding medium-risk skills gradually

---

## Phase 7 — Passive Context Sources (Day 60+)

Only begin after Phase 6 is complete and the pipeline has been stable for 2+ weeks.

### Google Keep (~1,000 notes)
- [ ] Decide on Keep API approach: Takeout automation (recommended) vs gkeepapi
- [ ] Implement Google Takeout import script for Keep notes
- [ ] Build Keep notes Ollama indexer (bulk one-time + weekly delta)
- [ ] Implement Phase 3 entity → Keep lookup and context injection
- [ ] Create `keep_notes` and `keep_index` tables

### AI Chat History
- [ ] Document chat history DB schema (which tables hold messages, timestamps, session IDs)
- [ ] Connect to chat history DB, implement nightly Ollama extraction job (runs at 03:00)
- [ ] Build `chat_signals` table + integration with relevance calibration (§13)
- [ ] Implement project signal injection into synthesis prompts
- [ ] Add user toggle in dashboard to enable/disable this feature

### Diary
- [ ] Decide on canonical diary format: Markdown files, SQLite, or Obsidian vault
- [ ] If in a mobile app (Day One, Journey), build export pipeline first
- [ ] Implement diary reader module (format-specific)
- [ ] Build weekly Ollama personal context extraction job (Sunday, abstract only)
- [ ] Add personal context block injection to Section 2 prompt
- [ ] Build personal context viewer/editor in SvelteKit dashboard (user can override)
- [ ] Create `personal_context` table

---

## Open Decisions (required before noted phase)

### Before Phase 4
- [ ] **Web search API choice** — Candidates:

  | API | Strengths | Pricing |
  |---|---|---|
  | **Brave Search API** | Privacy-first, independent index, no Google dependency | Free tier: 2,000 calls/month |
  | **Tavily** | Built for AI agents, structured results, good for news | ~$5/month at 3 searches/day |
  | **Serper** | Google results, fast, cheap | ~$1/month at 3 searches/day |
  | **Exa** | Semantic search, neural index, good for research | ~$5/month |
  | **SerpAPI** | Most complete, many sources | $50/month (overkill) |

  Recommendation: start with Brave (free tier = 3/day × 30 days exactly). Abstract behind internal `POST /search` so switching costs nothing. Upgrade to Tavily or Exa after 30 days if quality is insufficient.

- [ ] **Email self-hosting migration** — Currently on Netcup hosted email. Self-hosting (Postfix/Dovecot or Stalwart) is possible but not a blocker — IMAP interface is identical regardless. Decide after the system is stable.

### Before Phase 7
- [ ] **Keep API approach** — Options: `gkeepapi` (unofficial Python library, easy to use, risk of breaking on Google updates), Google Takeout automation (most reliable, weekly cadence is fine), or custom browser extension (most control, most effort). Recommended: start with Takeout export, automate via a Bun watcher script. Revisit gkeepapi after checking its current maintenance status.
- [ ] **Diary format and location** — Must be decided before implementing the diary reader. Options: Markdown files in a directory (simplest, easiest for Ollama), SQLite database (queryable), Obsidian vault. If the diary is in a mobile app (Day One, Journey, etc.), build an export pipeline first.

### Anytime (pre-seed before first run)
- [ ] **Family email addresses** — Add to contacts table (names and relationships are in `CONTEXT_AND_DECISIONS.md §8`, identifiers are blank)
- [ ] **Client email domains** — `hacibaba`, `zigarren-puro`, `is-rhein-sieg`, `alexanderhenkel` — add to contacts table for `priority: high` classification from day one instead of triggering the question gate
- [ ] **Default Google Tasks list for system-created items** — Confirm "To-Do Now" or "Work"; without this, `add_todo_item` skill defaults to an arbitrary list
- [ ] **Daily Life Rules** — Share the 13 items from Google Tasks "Daily Life Rules" list; standing rules (e.g. "always respond to client emails within 24h") are injected as standing context into the Section 2 system prompt
- [ ] **Recurring financial commitments** — Pre-load recurring invoices, subscriptions, and payment deadlines (server costs, domain renewals, SaaS, rent) so Section 2 correctly urgency-classifies financial emails from day one
- [ ] **University details** — University name, program, current semester: lets Section 2 correctly prioritize Uni-tagged tasks/emails and auto-boost urgency during exam periods
- [ ] **China trip dates** — Add to Google Calendar if not already there; the system auto-detects calendar entries and boosts China content in the 2-week pre-trip window
- [ ] **Preferred wake-up/read time** — Adjust cron from default 06:30 to match actual morning routine

### At 30-day mark
- [ ] Evaluate Netzpolitik.org as source #33 (EU digital regulation coverage — qwen2.5:14b handles German, no model change needed)
- [ ] Evaluate web search quality — upgrade from Brave to Tavily or Exa if result quality is insufficient
- [ ] Before initial Keep index run: review "Shower ideas" Keep category manually — likely contains entity references worth setting `importance = high` before the graph builds them organically

### Future (Phase 8+, do not build yet)
- [ ] **GitHub activity integration** — GitHub webhook or polling for PR reviews, CI failures, issue mentions across followed repos; most relevant once the briefing system is self-hosted and stable

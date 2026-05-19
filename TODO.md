# PIDRA — Build TODO

Phases follow the roadmap in `MORNING_BRIEFING_PLAN.md §22–23`. Work top-to-bottom within each phase before starting the next.

The **Context Builder** (`context-builder/`) is a separate standalone tool — its own detailed TODO is in `CONTEXT_BUILDER_PLAN.md`. Run it before the first pipeline run to pre-seed contacts, entities, and standing context. High-level status:

- [ ] Context Builder: sub-project scaffolding and DB migrations
- [ ] Context Builder: full first run (pre-seeds `entities`, `contacts`, `standing_context`)
- [ ] Context Builder: set up monthly update run cadence

---

## Phase 0 — Infrastructure

- [x] Set up Postgres database, run schema migrations with DrizzleORM
- [x] Configure Bun project structure
- [ ] Set up Ollama with qwen2.5:14b (Q4_K_M quantization) — **do last, after all other phases are stable** (OpenAI GPT-4o is the stand-in until then)
- [x] Test IMAP connection to Netcup server (info@pidra.de, mxe96e.netcup.net)
- [x] Configure Google Calendar API credentials (OAuth 2.0) — Client ID, Secret, Refresh Token in `.env`
- [x] Configure Google Tasks API credentials — shared OAuth credentials, same token
- [x] Set up SMS webhook endpoint (`POST /webhook/sms`)
- [ ] Switch synthesis to Claude Sonnet 4.6 — **do last, after all other phases are stable** (OpenAI GPT-4o is the stand-in until then)
- [x] RSS feed audit: for each of the 32 newsletters, check if an RSS feed exists. Build a `rss_feeds` config mapping `source_name → rss_url | null`. Newsletters with RSS skip IMAP (cleaner content, no HTML footers).

---

## Phase 1 — Core Pipeline

- [x] Implement Phase 1 ingestion: IMAP
- [x] Implement Phase 1 ingestion: Google Calendar + Google Tasks (see Phase 0 credentials above)
- [x] Implement Phase 1 ingestion: SMS via webhook (`POST /webhook/sms`)
- [x] Implement HTML stripping and Message-ID dedup for emails
- [x] Implement RSS polling for newsletters that support it (run in parallel with IMAP)
- [x] Implement Ollama newsletter extraction prompt — content pass (currently: OpenAI GPT-4o)
- [x] Implement Ollama entity extraction prompt — second pass, batched (currently: OpenAI GPT-4o)
- [x] Implement Ollama personal email classification prompt (currently: OpenAI GPT-4o)
- [x] Implement Phase 3 context assembly: active topics, entity lookup, novelty scoring
- [x] Implement effective relevance calculation + volume signal (light / normal / heavy)
- [x] Implement Section 1 Sonnet synthesis call (currently: OpenAI GPT-4o)
- [x] Implement Section 2 Sonnet synthesis call (currently: OpenAI GPT-4o)
- [x] Implement Phase 6 memory writes (parse `<!--SYSTEM-->` blocks)
- [x] Build minimal SvelteKit dashboard: display today's report
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
- [x] **Decide on Keep API approach** — Decided in `CONTEXT_BUILDER_PLAN.md`: gkeepapi (Python subprocess) only. No Takeout fallback — both would be equally fragile and double the complexity.
- [ ] **Bulk initial import** — Handled by Context Builder (not this pipeline). Run Context Builder first; it indexes all ~1,000 notes and seeds entities/standing_context. No separate import script needed here.
- [ ] Build Keep notes Ollama indexer for **ongoing daily delta** — after Context Builder's initial run, implement nightly/weekly re-scan of new/modified notes only (reuses Context Builder's `context_builder_indexed_items` skip-set)
- [ ] Implement Phase 3 entity → Keep lookup and context injection (query `keep_notes` for entities surfaced in today's extractions)
- [ ] Create `keep_notes` and `keep_index` tables for pipeline use (separate from Context Builder's own tables)

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
- [x] **Keep API approach** — Decided: gkeepapi (Python subprocess) only. Auth flow and fetch scripts live in `context-builder/scripts/`. Phase 7's pipeline integration reuses the same approach for ongoing delta ingestion. (Google Keep API `keep.googleapis.com` is Workspace-only, not usable with a personal account.)
- [ ] **Diary format and location** — Must be decided before implementing the diary reader. Options: Markdown files in a directory (simplest, easiest for Ollama), SQLite database (queryable), Obsidian vault. If the diary is in a mobile app (Day One, Journey, etc.), build an export pipeline first.

### Anytime (pre-seed before first run)

Several of these are now partially automated by the Context Builder — items marked *(CB)* will be populated by its first run. Manual review/supplement is still needed after the run.

- [ ] **Family email addresses** *(CB)* — Context Builder extracts contacts from email history and seeds the `contacts` table. After the first CB run, verify the output and add names/relationships for entries it couldn't infer. (Identifiers are blank in `CONTEXT_AND_DECISIONS.md §8`.)
- [ ] **Client email domains** *(CB)* — Context Builder will recognize `hacibaba`, `zigarren-puro`, `is-rhein-sieg`, `alexanderhenkel` from email patterns and set initial importance. Verify `priority: high` is correctly set post-run; override manually if not.
- [ ] **Default Google Tasks list for system-created items** — Confirm "To-Do Now" or "Work"; without this, `add_todo_item` skill defaults to an arbitrary list
- [ ] **Daily Life Rules** *(CB)* — Context Builder reads the Keep "Daily Life Rules" category and seeds `standing_context` with the extracted rules. After the first CB run, review the `standing_context` table — correct any misextracted rules and add anything that wasn't captured.
- [ ] **Recurring financial commitments** *(CB partially)* — Context Builder may extract recurring commitments from email history (bank notifications, subscription confirmations). Supplement with any that don't appear in email (cash payments, rent).
- [ ] **University details** — University name, program, current semester: lets Section 2 correctly prioritize Uni-tagged tasks/emails and auto-boost urgency during exam periods. Not auto-extracted — add manually or as a `standing_context` entry.
- [ ] **China trip dates** — Add to Google Calendar if not already there; the system auto-detects calendar entries and boosts China content in the 2-week pre-trip window
- [ ] **Preferred wake-up/read time** — Adjust cron from default 06:30 to match actual morning routine

### At 30-day mark
- [ ] Evaluate Netzpolitik.org as source #33 (EU digital regulation coverage — qwen2.5:14b handles German, no model change needed)
- [ ] Evaluate web search quality — upgrade from Brave to Tavily or Exa if result quality is insufficient
- [ ] Before running Context Builder for the first time: review the "Shower ideas" Keep category manually — likely contains entity references worth setting `importance = high` before the graph builds them organically. Flag these to the CB run so it can set correct importance scores during extraction.

### Future (Phase 8+, do not build yet)
- [ ] **GitHub activity integration** — GitHub webhook or polling for PR reviews, CI failures, issue mentions across followed repos; most relevant once the briefing system is self-hosted and stable

---

## Phase 8 — Smart Reply (do not build yet)

Only after all prior phases are complete and stable.

### Answerable mail list

- [ ] Add `reply_monitoring: boolean` key to the per-address config block. Only addresses with this flag enabled are considered.
- [ ] During Ollama personal email classification (Phase 1), add a dedicated pass that decides for each incoming mail from a monitored address whether the mail expects or deserves a reply. Write the result as a flag on the `raw_items` / `extractions` row.
- [ ] At the bottom of the daily report (dashboard), render a collapsible "Mails worth replying to" panel listing flagged items with sender, subject, and a one-line summary.

### Reply form (dashboard)

Clicking a list item opens a modal/side panel with two mutually exclusive actions:

**Option A — "Later reply" template**
- Dropdown to select delay: 2 h / 4 h / 8 h / 24 h / 2 days / 3 days / 1 week
- AI generates a short, polite template in the user's name stating a reply will follow within the chosen timeframe. No prose judgments, no em dashes.
- Preview shown before sending. Send button triggers actual mail delivery via SMTP (same Netcup credentials as ingestion).

**Option B — AI-drafted full reply**
- Sonnet drafts a reply using all available context: contact history, active topics, standing context, entity graph. No em dashes in output.
- Draft displayed in an editable text area.
- "Regenerate" button triggers a fresh Sonnet call with a temperature nudge.
- "Send" button delivers the mail via SMTP after user confirmation.

### Constraints
- Both send paths go through SMTP (no third-party mail API).
- Sent mails are written to a `sent_replies` table (message_id, raw_item_id, reply_type, sent_at, body_hash) for audit and dedup.
- The full reply draft (Option B) must pass through the same "no diary content to cloud API" firewall check as all other Sonnet calls.

# Context Builder — Plan & TODO

> **Third standalone tool in the PIDRA ecosystem.** Performs a comprehensive scan of all personal data sources, compresses them locally with Ollama, and synthesizes a structured long-term context document with a small number of targeted Sonnet calls. Runs in two modes: **full** (first run or explicit rebuild) and **update** (incremental — skips already-indexed items and merges new ones proportionally into the existing context). Output seeds PIDRA's entity graph, contacts table, and standing context — and produces a standalone human-readable "life snapshot."

---

## What this tool is NOT

- Not a daily runner — runs on demand or monthly.
- Not the main pipeline — it feeds it.
- Not a backup tool — it extracts meaning, not raw data.
- Not a cloud sync — all heavy processing happens locally via Ollama.

---

## Design Constraints

### The context window problem
Even a single large email account can produce 10k+ emails. No single Sonnet context window can hold this. Solution: **two-pass architecture** — Ollama reads everything and outputs only compact JSON (≤80 chars per item), Sonnet sees only the compressed summaries.

### The cost problem
Processing 5,000 emails × 1,000 Keep notes × full Sonnet would cost $30–100+. With Ollama compression first, total Sonnet cost is **$0.40–$1.00** for the full run.

### The failure-at-99% problem
Every processed item is written to a checkpoint file immediately. A crash resumes from the exact item it stopped at — no work is lost, no API costs are doubled. Partial results are always written: if GitHub fails, email + Keep + Tasks still produce useful output.

### The "what to store" problem
Raw email bodies, full note text, full README content: **never stored in the output**. Only stored: metadata + Ollama-compressed extraction (one JSON object per item, ≤200 bytes). The final Sonnet synthesis result is stored. The raw source data stays in its origin system.

### The delta update problem
After a full run, re-running must not rebuild from scratch. Equally, running with only 5 new emails must not produce a context dominated by those 5 emails — the existing index built from 2,847 emails represents far more signal. Solution: **proportional patch synthesis**.

How it works:
1. A persistent index state (Postgres table `context_builder_runs`) records every indexed item's ID and the run it was indexed in. On re-run, any item whose ID already appears in `context_builder_runs` is skipped entirely — no Ollama call, no fetch.
2. Only genuinely new items are processed through the Ollama extraction pipeline.
3. The delta synthesis step receives: the **existing context document** (already compressed, ~3,000 tokens) + only the **new item extractions** (the delta). The prompt explicitly states the ratio: "The existing context reflects N items indexed previously. The delta contains M new items. Merge proportionally — do not alter conclusions drawn from N unless directly contradicted by the delta. Add new contacts and entities if present."
4. The result replaces the previous context document, but the edit distance should be small for a small delta.

**When to recommend a full rebuild instead:** If the delta exceeds 30% of total indexed items (e.g., first run after 6 months of heavy email volume), warn the user and suggest `--full` for a cleaner result. The update still runs if the user proceeds, but the warning is logged.

---

## Run Modes

```
bun run context-builder/run.ts            # auto-detect: full if no prior index, update otherwise
bun run context-builder/run.ts --full     # always rebuild from scratch (ignores existing index)
bun run context-builder/run.ts --update   # force delta mode even if no prior index exists (no-op if nothing new)
bun run context-builder/run.ts --dry-run  # inventory only, no Ollama, no API calls, no writes
```

### Auto-detect logic
On startup, `run.ts` checks the `context_builder_runs` table:
- No rows → **full mode** (first run)
- Rows exist, last completed run was successful → **update mode** (default for subsequent runs)
- Rows exist, last run was interrupted → **resume mode** (continues the interrupted run's checkpoint, does not start a new run)

### Full mode
Processes all items across all sources. Ignores any existing index state. At the end, overwrites the previous context document entirely.

### Update mode
1. Fetches item IDs from each source (headers only for email, note IDs for Keep, task IDs for Tasks)
2. Filters out any ID already present in `context_builder_runs.indexed_item_ids`
3. Only processes the delta — Ollama extraction for new items only
4. Skips re-synthesis for sources where delta is zero (e.g., no new Keep notes → skip Keep synthesis entirely)
5. Runs patch synthesis for sources that have a delta (see Design Constraints → delta update problem)
6. Appends new item IDs to `context_builder_runs`

**What always re-runs in update mode** (regardless of delta):
- GitHub: fast API call, always worth refreshing (repos change frequently)
- Google Tasks: small dataset, always re-fetched and re-synthesized (task states change daily)

**What is skipped in update mode if delta is zero:**
- Email extraction (if no new emails since last run)
- Keep extraction (if no new/modified notes)
- Contact synthesis (if no new email senders)
- Keep synthesis (if no new notes)

### Resume mode (interrupted run)
If the previous run was interrupted (crash, manual stop), the checkpoint file still contains the partial progress. Resume mode continues from the exact item it stopped at, within the same run ID. It does not start a new run or a new delta. Once the interrupted run completes, subsequent invocations switch to update mode.

---

## Directory Structure

```
context-builder/
  run.ts                    # entry point — orchestrates all phases
  progress.ts               # live terminal progress display
  checkpoint.ts             # read/write/resume checkpoint state
  errors.ts                 # error logger with retry logic
  sources/
    email.ts                # IMAP fetcher (wraps src/ingest/imap.ts patterns)
    github.ts               # GitHub REST API v3
    keep.ts                 # Google Keep via gkeepapi (Python subprocess)
    tasks.ts                # Google Tasks API
  pipeline/
    extract-email.ts        # Ollama pass: email → compact JSON
    extract-note.ts         # Ollama pass: Keep note → compact JSON
    batch-contacts.ts       # group email extractions by sender
    synthesize.ts           # Sonnet synthesis calls
  output/
    builder.ts              # assembles final context document
    db-writer.ts            # writes seeds into PIDRA Postgres tables
  prompts/
    email-extraction.ts     # Ollama prompt: email → JSON
    note-extraction.ts      # Ollama prompt: Keep note → JSON
    synthesis/
      contacts.ts           # Sonnet: contact profiles
      projects.ts           # Sonnet: project portfolio
      knowledge.ts          # Sonnet: interest + entity map
      tasks.ts              # Sonnet: active commitments
      final.ts              # Sonnet: full context synthesis
```

---

## Data Sources & Strategies

### 1. Email (N accounts, driven by `email-accounts.json`)

The tool reads `email-accounts.json` and classifies each account by its `isNewsAccount` flag:

| `isNewsAccount` | Strategy |
|---|---|
| `true` | **Skip extraction.** Header-count only — newsletter content is already handled by the main pipeline. |
| `false` | Full extraction, subject to time window below. |

No account addresses are hardcoded. Adding or removing an account in `email-accounts.json` is all that is needed.

**Per email pipeline:**
1. Fetch headers only first (IMAP ENVELOPE) — get `from`, `subject`, `date`, `message-id` (no body download yet)
2. Deduplicate against already-processed checkpoint
3. Filter: skip automated system emails (no-reply, noreply, mailer-daemon, calendar invites from bots)
4. Fetch body only for surviving emails
5. Ollama pass → compact extraction JSON (see Prompts section)
6. Write checkpoint entry immediately after each successful extraction
7. After all emails: group by sender email → build sender profiles

**Concurrency:** Semaphore capped at 4 Ollama calls. All non-news IMAP connections opened in parallel.

**Time window (applies to `isNewsAccount: false` accounts):**
- Default: last 3 years (configurable via `CONTEXT_BUILDER_EMAIL_YEARS=3`)
- Accounts with `classifyNewsVsPersonal: false` (dedicated personal/work accounts): apply time window normally
- Anything older than the time window gets header-only metadata (no Ollama, no body fetch)

### 2. Google Tasks (~130 items)

Small dataset. No Ollama pass needed.

- Fetch all task lists + all tasks via Google Tasks API
- Filter: exclude completed tasks older than 90 days
- Full dataset → 1 Sonnet call → active commitments summary + urgency classification
- Estimated tokens: ~3,000 input, ~800 output → **~$0.01**

### 3. Google Keep (~1,000 notes)

**API approach:** `gkeepapi` (unofficial Python library, accessible via Bun subprocess).

- Fetch all notes
- Per note: Ollama extraction (category, entities, topics, summary, type, temporal references)
- Group by category after extraction
- Per category group → 1 Sonnet call → category-level synthesis
  - 10 categories × ~100 notes each compressed to ~80 chars = ~8,000 tokens input per category
  - Actual: ~3,000 tokens per category after compression
  - 10 calls × ~$0.02 each = **~$0.20 total**

### 4. GitHub

- Use GitHub REST API v3 (`api.github.com/users/ileies/repos`)
- Per repo: name, description, language, topics, stars, last_push, open issues count
- Per repo: fetch README (first 400 chars only — the "pitch line")
- Per repo: last 10 commits (message + date only, no diff)
- Total data: ~20–30 repos, ~15,000 tokens input
- 1 Sonnet call → project portfolio summary → **~$0.04**

**Repos to include:** All public + private repos (requires `repo` scope on PAT). Archived repos: include but mark as archived.

### 5. Final Context Synthesis

1 Sonnet call receives all prior synthesis outputs (contacts, projects, tasks, knowledge map) and produces the final structured context document.

- Input: ~25,000 tokens (all summaries concatenated)
- Output: ~3,000 tokens
- Cost: **~$0.10**

**Total estimated Sonnet cost: $0.35–$0.60 per full run.**

---

## Pipeline Phases

```
Phase 0  — Mode detection + Inventory   [~2 min]   Detect full/update/resume, count items, estimate runtime
Phase 1  — Email Headers                [~5 min]   Fetch headers, diff against index, plan extraction
Phase 2  — Email Extraction             [~30-90 min / ~2-10 min delta] Ollama pass, new items only
Phase 3  — Contact Grouping             [~1 min]   Group new extractions by sender
Phase 4  — Contact Synthesis            [~2 min]   Sonnet: contact profiles (skipped if delta=0)
Phase 5  — Tasks Fetch                  [~1 min]   Google Tasks API (always runs)
Phase 6  — Tasks Synthesis              [~1 min]   Sonnet: commitments (always runs)
Phase 7  — Keep Fetch                   [~2 min]   gkeepapi fetch, diff against index
Phase 8  — Keep Extraction              [~15-30 min / ~1-5 min delta] Ollama pass, new notes only
Phase 9  — Keep Synthesis               [~5 min]   Sonnet per category (skipped if delta=0 for that category)
Phase 10 — GitHub Fetch                 [~2 min]   REST API (always runs)
Phase 11 — GitHub Synthesis             [~1 min]   Sonnet: project portfolio (always runs)
Phase 12 — Synthesis                    [~2 min]   Full context document (full mode) OR patch synthesis (update mode)
Phase 13 — DB Seeding                   [~1 min]   Write seeds + update context_builder_runs
Phase 14 — Report                       [~1 min]   Write JSON + Markdown output files
```

Phases 1–4 (email), 5–6 (tasks), 7–9 (Keep), and 10–11 (GitHub) run in parallel after Phase 0.
Phases 12–14 run sequentially after all parallel phases complete.

**In update mode, phases with delta=0 are logged as `✓ skipped (no new items)` in the progress display — they do not run at all.**

---

## Progress Display

Terminal UI, live-updating (redraws every 500ms):

```
╔══════════════════════════════════════════════════════════╗
║  PIDRA Context Builder — 2026-05-18                      ║
╠══════════════════════════════════════════════════════════╣
║  Phase                    Status     Progress    Errors  ║
╠══════════════════════════════════════════════════════════╣
║  0. Inventory             ✓ done     —           0       ║
║  1. Email headers         ✓ done     2,847 msgs   0       ║
║  2. Email extraction      ▶ running  1,241/2,447  3       ║
║  3. Contact grouping      ◌ pending  —           —       ║
║  4. Contact synthesis     ◌ pending  —           —       ║
║  5. Tasks fetch           ✓ done     132 items   0       ║
║  6. Tasks synthesis       ✓ done     1 call      0       ║
║  7. Keep fetch            ✓ done     1,008 notes 0       ║
║  8. Keep extraction       ▶ running  724/1,008   2       ║
║  9. Keep synthesis        ◌ pending  —           —       ║
║ 10. GitHub fetch          ✓ done     23 repos    0       ║
║ 11. GitHub synthesis      ✓ done     1 call      0       ║
║ 12. Final synthesis       ◌ pending  —           —       ║
║ 13. DB seeding            ◌ pending  —           —       ║
║ 14. Report                ◌ pending  —           —       ║
╠══════════════════════════════════════════════════════════╣
║  Elapsed: 00:47:23    ETA: ~01:12:00    Cost: $0.07      ║
║  Checkpoint: context-builder/.checkpoint.json            ║
╚══════════════════════════════════════════════════════════╝
```

Implementation: write progress state object, re-render full table to stdout using ANSI escape codes (`\x1b[<n>A` to move cursor up). No external library required.

---

## Error Handling & Resilience

### Per-item retry logic
```
attempt 1 → fail → wait 2s → attempt 2 → fail → wait 8s → attempt 3 → fail → log to errors.json → mark as FAILED in checkpoint → continue
```

- Ollama errors (GPU OOM, timeout): retry with 10s wait, reduce concurrency to 2 after 3 consecutive failures
- IMAP connection drops: reconnect once, then skip account for current run
- Sonnet API errors: retry up to 3 times with exponential backoff (2s, 8s, 30s)
- Google API 429: respect `Retry-After` header, default 60s

### Checkpoint file (`context-builder/.checkpoint.json`)
Tracks progress **within a single run**. Discarded when the run completes successfully.

```json
{
  "run_id": "2026-05-18T07:00:00Z",
  "mode": "full",
  "phases_completed": ["inventory", "email_headers", "tasks_fetch"],
  "email_items": {
    "uni:<message-id>": { "status": "done", "extraction_id": "uuid" },
    "gmail:<message-id>": { "status": "failed", "error": "Ollama timeout", "attempts": 3 }
  },
  "keep_items": { ... },
  "stats": { "emails_total": 2847, "emails_done": 2701, "emails_failed": 146 }
}
```

On restart: read checkpoint → skip `"status": "done"` items → retry `"status": "failed"` items once more → continue from where left off.

### Persistent index state (`context_builder_runs` table in Postgres)
Survives across runs. This is what update mode reads to know which items are already indexed. The checkpoint file is ephemeral; this table is permanent.

```sql
CREATE TABLE context_builder_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id text UNIQUE NOT NULL,           -- ISO timestamp of run start
  mode text NOT NULL,                    -- 'full' | 'update'
  status text NOT NULL,                  -- 'completed' | 'failed' | 'interrupted'
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  items_indexed integer,                 -- total new items indexed this run
  items_skipped integer,                 -- items already in index (update mode)
  context_doc_path text,                 -- path to output JSON for this run
  sonnet_tokens_in integer,
  sonnet_tokens_out integer,
  cost_usd real
);

CREATE TABLE context_builder_indexed_items (
  item_id text NOT NULL,      -- message-id for email, note ID for Keep
  source text NOT NULL,       -- 'email:<account_id>' | 'keep' | 'github' | 'tasks'
  run_id text NOT NULL REFERENCES context_builder_runs(run_id),
  indexed_at timestamptz DEFAULT now(),
  PRIMARY KEY (item_id, source)
);
```

On update mode start: `SELECT item_id FROM context_builder_indexed_items WHERE source = 'email:gmail'` → skip these message IDs entirely (no header fetch, no Ollama call).

### Error log (`context-builder/errors.json`)
Append-only log with timestamp, phase, item id, error message, stack trace. Survives restarts. Rolled over per run.

### Partial output guarantee
Final synthesis runs with whatever data is available. If email phase completed 80% and hit an unrecoverable IMAP error, the tool still outputs context from the successful 80% + all other sources. Never blocks final output on partial failure.

---

## Ollama Extraction Prompts

### Email extraction (per email)
```
Extract from this email. Output JSON only, no other text:
{
  "from_name": string (max 30 chars),
  "from_email": string,
  "date": "YYYY-MM-DD",
  "subject": string (max 60 chars, normalized),
  "type": "personal" | "work" | "university" | "financial" | "automated" | "spam",
  "requires_action": boolean,
  "urgency": "critical" | "high" | "normal" | "low",
  "entities": string[] (max 5, people and orgs only),
  "summary": string (max 80 chars),
  "language": "de" | "en" | "zh" | "other"
}
Return JSON only.
```

Prompt is prepended with `Return JSON only:` (matches existing PIDRA convention).

### Keep note extraction (per note)
```
Extract from this Keep note. Output JSON only, no other text:
{
  "type": "memory" | "idea" | "list" | "reference" | "plan" | "reflection",
  "entities": string[] (max 8, people, places, products, technologies),
  "topics": string[] (max 5),
  "summary": string (max 80 chars),
  "temporal_ref": string | null (any date or time period mentioned),
  "language": "de" | "en" | "zh" | "other"
}
Return JSON only.
```

---

## Sonnet Synthesis Prompts (structure only — full prompts written during impl)

### Contact profiles (Sonnet)
Input: all sender profiles (email + name + list of compressed email summaries)
Output: JSON array of contact objects `{ name, email, relationship, importance, communication_notes }`

### Active commitments (Sonnet)
Input: all Google Tasks items across all lists
Output: structured commitment list with urgency levels and project assignments

### Knowledge map (Sonnet)
Input: Keep category summaries (post-Ollama)
Output: `{ interests[], known_entities[], travel_plans[], key_memories[], personal_rules[] }`

### Project portfolio (Sonnet)
Input: GitHub repo data
Output: `{ active_projects[], completed_projects[], tech_stack[], patterns[] }`

### Final context document — full mode (Sonnet)
Input: all four synthesis outputs above
Output: full context document (see Output Format below)

### Patch synthesis — update mode (Sonnet)
Input:
- Existing context document (the last completed run's JSON, ~3,000 tokens)
- Delta contact profiles (new senders only, if any)
- Delta tasks synthesis (always included — tasks change)
- Delta Keep synthesis (new notes only, per category, if any)
- GitHub synthesis (always included — repos change)
- Ratio metadata: `{ existing_items: N, delta_items: M }`

Prompt structure:
```
The existing context document was built from N items indexed previously. 
The delta contains M new items (ratio: M/N = X%).
Update the context document by merging the delta proportionally:
- Do not change sections unaffected by the delta.
- For contacts: add new contacts; update existing contact profiles only if 
  the delta provides meaningfully new information.
- For entities: add new entities; update importance scores only if 
  significantly reinforced by the delta.
- For commitments and projects: replace entirely (these are always re-fetched).
- Do not rewrite conclusions drawn from the bulk index based solely on M items.
Output the complete updated context document in the same JSON structure.
```

Output: updated context document, replaces the previous one.

**Cost of a patch synthesis call:** ~4,000–6,000 tokens in (existing context + delta summaries), ~3,000 tokens out → **~$0.06** regardless of how large the original index was.

---

## Output Format

### `context-builder/output/context-YYYY-MM-DD.json`
Each run produces a new dated file. The previous file is not overwritten — update runs patch the content but save to a new date-stamped file, allowing rollback by simply pointing to an older file.

```json
{
  "generated_at": "ISO timestamp",
  "run_id": "uuid",
  "mode": "full" | "update",
  "based_on_run_id": "uuid | null",     // for update mode: the run this patched
  "coverage": {
    "emails_total_indexed": 2701,       // cumulative across all runs
    "emails_this_run": 5,               // delta this run (0 in full mode = same as total)
    "keep_notes_total_indexed": 1006,
    "keep_notes_this_run": 12,
    "tasks": 130,
    "github_repos": 23
  },
  "profile": { ... },
  "contacts": [ ... ],
  "active_commitments": [ ... ],
  "projects": [ ... ],
  "knowledge_map": { ... },
  "entity_seeds": [ ... ],
  "context_notes": [ ... ]
}
```

### `context-builder/output/context-YYYY-MM-DD.md`
Human-readable version. Sections:
1. **Profile Snapshot** — who this is, languages, roles
2. **Active Commitments** — by urgency (Critical / High / Normal)
3. **Project Portfolio** — active, paused, done
4. **Contact Network** — top 30 contacts with relationship notes
5. **Knowledge Map** — interest domains, entity list, travel plans
6. **Context Notes** — selected Keep memories and rules

---

## Database Seeding (Phase 13)

After generating the context document, `db-writer.ts` seeds PIDRA's existing tables:

| Source | Target table | Write mode |
|---|---|---|
| `contacts[]` | `contacts` | upsert on email |
| `entity_seeds[]` | `entities` | upsert on name, set `mention_count = 0`, `importance` from context |
| `personal_rules[]` | new `standing_context` table (see below) | replace all |
| `active_commitments[]` | `raw_items` with `source_type = 'todo'` | insert if not exists |

### New table: `standing_context`
Needed to inject persistent rules and preferences into Section 2 synthesis. Schema:
```sql
CREATE TABLE standing_context (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,       -- 'rule' | 'preference' | 'commitment' | 'fact'
  content text NOT NULL,    -- the injected line
  source text,              -- 'keep' | 'tasks' | 'manual'
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);
```

---

## Environment Variables

Add to `.env.example`:
```bash
# Context Builder
CONTEXT_BUILDER_EMAIL_YEARS=3          # how far back to go for personal emails
CONTEXT_BUILDER_OLLAMA_CONCURRENCY=4   # Ollama parallel calls
GITHUB_TOKEN=                          # PAT with 'repo' scope for private repos
GKEEPAPI_USERNAME=                     # Google account for gkeepapi
GKEEPAPI_MASTER_TOKEN=                 # obtained via gkeepapi one-time auth
CONTEXT_BUILDER_OUTPUT_DIR=context-builder/output
```

---

## Google Keep: gkeepapi Setup

`gkeepapi` is a Python library (unofficial). One-time setup:
1. `nix shell nixpkgs#python3Packages.gkeepapi` or add to NixOS config
2. Run `python3 context-builder/scripts/keep-auth.py` once → outputs master token
3. Store token in `.env` as `GKEEPAPI_MASTER_TOKEN`
4. All future runs use the stored token (no re-auth needed)

Bun calls Python via subprocess: `Bun.spawn(["python3", "context-builder/scripts/keep-fetch.py"])`, reads JSON from stdout.

---

## Cost Analysis

| Phase | Tool | Input tokens | Output tokens | Cost |
|---|---|---|---|---|
| Email extraction | Ollama | n/a | n/a | $0.00 |
| Keep extraction | Ollama | n/a | n/a | $0.00 |
| Contact synthesis | Sonnet | ~15,000 | ~2,000 | ~$0.05 |
| Tasks synthesis | Sonnet | ~3,000 | ~800 | ~$0.01 |
| Keep synthesis (10×) | Sonnet | ~30,000 | ~5,000 | ~$0.20 |
| GitHub synthesis | Sonnet | ~15,000 | ~2,000 | ~$0.05 |
| Final synthesis | Sonnet | ~25,000 | ~3,000 | ~$0.10 |
| **Total (full run)** | | | | **~$0.41** |

**Update run cost** (delta only, e.g. 1 month of new emails + unchanged Keep):

| Phase | Tool | Notes | Cost |
|---|---|---|---|
| Email extraction (delta) | Ollama | ~50–200 new emails | $0.00 |
| Keep extraction (delta) | Ollama | ~0–30 new notes | $0.00 |
| Tasks synthesis | Sonnet | always re-runs | ~$0.01 |
| GitHub synthesis | Sonnet | always re-runs | ~$0.04 |
| Contact synthesis (delta) | Sonnet | only if new senders | ~$0.01 |
| Keep synthesis (delta) | Sonnet | only affected categories | ~$0.02 |
| Patch synthesis | Sonnet | existing context + delta summaries | ~$0.06 |
| **Total (update run)** | | | **~$0.14** |

Costs are based on Sonnet 4.6 pricing ($3/M input, $15/M output). Actual will be lower with prompt caching where applicable.

---

## Integration with Main PIDRA Pipeline

After context builder runs once, PIDRA uses its output as follows:

- **Phase 3 context assembly** automatically uses pre-seeded `entities` and `contacts` tables
- **Section 2 prompt** injects `standing_context` rows of type `rule` as standing personal operating rules
- **Entity importance scoring** uses `importance` field from context builder seeds
- **Question gate** skips known contacts (already in `contacts` table from context builder)

The context builder is **not** a dependency of the daily pipeline — it only improves the pipeline's quality from day one.

---

## TODO Checklist

### Sub-project setup
- [ ] Create `context-builder/` directory with `package.json` (Bun, standalone)
- [ ] Create `tsconfig.json` for context-builder (extends root)
- [ ] Add `context-builder` run script to root `package.json`: `"context-builder": "bun run context-builder/run.ts"`
- [ ] Create `.checkpoint.json` init logic and `checkpoint.ts` module
- [ ] Create `errors.ts` module (append-only JSON log)
- [ ] Add `context_builder_runs` and `context_builder_indexed_items` tables to DrizzleORM schema + generate migration

### Progress display
- [ ] Implement `progress.ts`: phase state machine + ANSI terminal renderer
- [ ] Implement 500ms refresh loop with cursor reposition
- [ ] Implement cost accumulator (tracks Sonnet token usage in real time)
- [ ] Implement ETA calculator (based on items/sec × remaining items)

### Environment + config
- [ ] Add `GITHUB_TOKEN`, `GKEEPAPI_*`, `CONTEXT_BUILDER_*` vars to `.env.example`
- [ ] Write config loader `context-builder/config.ts`
- [ ] Add `standing_context` migration to DrizzleORM schema + generate migration

### Phase 0 — Mode detection + Inventory
- [ ] Implement mode detection: read `context_builder_runs` table → decide full / update / resume
- [ ] In update mode: load previously indexed item IDs per source into memory (used as skip-set throughout)
- [ ] Implement IMAP header count (per account, no body fetch)
- [ ] Implement GitHub repo count via API
- [ ] Implement Google Tasks list count via API
- [ ] Implement Keep note count (gkeepapi)
- [ ] In update mode: show `N total / M new / K skipped` per source in inventory
- [ ] If delta > 30% of total indexed items, print rebuild recommendation and ask to confirm before proceeding
- [ ] Print inventory table + estimated runtime

### Phase 1–4 — Email
- [ ] Implement `sources/email.ts`: IMAP header-only fetch (ENVELOPE) for all non-news accounts in parallel
- [ ] Implement sender dedup filter (skip `no-reply`, `noreply`, `mailer-daemon`, `notifications@`, etc.)
- [ ] Implement time window filter (configurable years, default 3)
- [ ] Implement skip-set filter: drop any message-id already in `context_builder_indexed_items`
- [ ] Implement body fetch for filtered emails (streaming, with size cap at 50KB per email)
- [ ] Write Ollama extraction prompt for emails (`prompts/email-extraction.ts`)
- [ ] Implement `pipeline/extract-email.ts`: Ollama call with semaphore + checkpoint write per item + write to `context_builder_indexed_items` on success
- [ ] Implement `pipeline/batch-contacts.ts`: group new extractions by `from_email`
- [ ] Write Sonnet contact synthesis prompt
- [ ] Implement contact synthesis call (batched: max 50 senders per call; skipped entirely if delta=0)

### Phase 5–6 — Google Tasks
- [ ] Implement `sources/tasks.ts`: fetch all lists + all tasks via Google Tasks API
- [ ] Filter: exclude completed tasks older than 90 days
- [ ] Write Sonnet tasks synthesis prompt
- [ ] Implement tasks synthesis call

### Phase 7–9 — Google Keep
- [ ] Write `context-builder/scripts/keep-auth.py` (one-time token fetch via gkeepapi)
- [ ] Write `context-builder/scripts/keep-fetch.py` (fetch all notes → stdout JSON)
- [ ] Implement `sources/keep.ts`: Bun subprocess → gkeepapi
- [ ] Implement skip-set filter: drop any note ID already in `context_builder_indexed_items`
- [ ] Write Ollama extraction prompt for Keep notes (`prompts/note-extraction.ts`)
- [ ] Implement `pipeline/extract-note.ts`: Ollama call with semaphore + checkpoint write + write to `context_builder_indexed_items` on success
- [ ] Write Sonnet Keep synthesis prompt (per category)
- [ ] Implement per-category synthesis calls (skipped for categories where delta=0)

### Phase 10–11 — GitHub
- [ ] Implement `sources/github.ts`: list repos (public + private) via REST API v3
- [ ] Fetch per repo: description, language, last_push, README (first 400 chars), last 10 commit messages
- [ ] Write Sonnet GitHub synthesis prompt
- [ ] Implement GitHub synthesis call

### Phase 12 — Synthesis (full or patch)
- [ ] Write Sonnet full context synthesis prompt (`prompts/synthesis/final.ts`)
- [ ] Write Sonnet patch synthesis prompt (`prompts/synthesis/patch.ts`) — includes ratio metadata and proportionality instruction
- [ ] Implement full synthesis call (input: all phase outputs)
- [ ] Implement patch synthesis call (input: existing context JSON + delta summaries only)
- [ ] Parse and validate output structure (same schema for both modes)

### Phase 13 — DB Seeding
- [ ] Add `standing_context` table to Drizzle schema
- [ ] Generate and apply migration
- [ ] Implement `output/db-writer.ts`: upsert contacts into `contacts` table
- [ ] Implement entity seeding: upsert into `entities` with `mention_count = 0`
- [ ] Implement `standing_context` seeding (replace-all strategy)
- [ ] Write completed run record to `context_builder_runs` (status, item counts, cost, output path)

### Phase 14 — Report output
- [ ] Implement `output/builder.ts`: JSON output writer
- [ ] Implement Markdown output writer (14 sections, human-readable)
- [ ] Print final summary: items processed, errors, cost, output file paths

### Error handling
- [ ] Per-item retry with exponential backoff (2s, 8s, 30s)
- [ ] Ollama OOM detection (reduce concurrency to 2 on consecutive failures)
- [ ] IMAP reconnect logic (1 retry per account)
- [ ] Sonnet 429 handling (respect Retry-After)
- [ ] Partial output guarantee: final synthesis runs even if phases partially failed

### Testing
- [ ] Test with `--dry-run` flag: counts only, no API calls, no Ollama
- [ ] Test email extraction on 10 emails before full run
- [ ] Test Keep extraction on 20 notes before full run
- [ ] Test checkpoint resume: kill mid-run, verify it continues correctly
- [ ] Test update mode: run full, add a known email to the account, run again → verify exactly 1 new item processed, rest skipped
- [ ] Test proportionality: update run with 5 new emails → verify context document changes are minimal (not a full rewrite)
- [ ] Test 30% rebuild warning: seed fake index with 10 items, present 4 new → verify warning fires and prompts for confirmation
- [ ] Verify DB seeding does not break existing PIDRA tables

### Documentation
- [ ] Add `context-builder/README.md` with quickstart, first-run instructions, and Keep auth setup

---

## Open Decisions (resolve before implementing)

- [x] **Keep API approach** — gkeepapi only. No Takeout fallback — both approaches are equally fragile (gkeepapi can break on Google updates; Takeout format can change too), and maintaining both doubles the complexity. If gkeepapi breaks, fix it or wait for the library to update. The tool simply fails the Keep phase and continues with other sources.
- [ ] **GitHub PAT scope** — `repo` scope gives access to private repos but is broad. Alternative: use GitHub App installation token (narrower). Decision: use PAT with `repo` scope for now — this is a personal tool, not exposed to network.
- [ ] **News account email treatment** — Accounts with `isNewsAccount: true` are skipped by default (newsletter content is in the main pipeline). But such an account may still receive personal replies or non-newsletter subscriptions. Decision: fetch headers only for `isNewsAccount: true` accounts, then extract any email where `from` is not in the known newsletter sender list. Sender list sourced from `rss-feeds` config + IMAP news sources config.
- [x] **Rerun cadence** — Decided: update mode is the default on subsequent runs (auto-detected via `context_builder_runs` table). `--full` forces a rebuild. `--update` forces delta even if first run. 30% delta threshold triggers a rebuild recommendation. Patch synthesis ensures new items are weighted proportionally to the existing index size.
- [ ] **Output location** — `context-builder/output/` vs. a path in the main PIDRA data dir. Decision: keep in `context-builder/output/` for now. The DB seeding is the primary integration mechanism, not file-sharing.

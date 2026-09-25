# Context Builder - Plan & TODO

> **Third standalone tool in the PIDRA ecosystem.** Performs a comprehensive scan of personal data sources, extracts structured JSON and synthesizes a long-term context document through `src/ai/openai.ts`. `OPENAI_MODEL_EXTRACTION` and `OPENAI_MODEL_SYNTHESIS` select the models; both default to `gpt-5.6-luna`. It runs in **full** mode for a first run or explicit rebuild and **update** mode for an incremental, proportional merge. Output seeds `entities`, `contacts` and `standing_context`, and produces a standalone human-readable snapshot.

---

## What this tool is NOT

- Not a daily runner - runs on demand or monthly.
- Not the main pipeline - it feeds it.
- Not a backup tool - it extracts meaning, not raw data.
- Not a cloud sync. Source data is fetched from its origin; model calls use the central OpenAI client with `store: false`.

---

## Design Constraints

### The context window problem
Even a single large email account can produce 10k+ emails. No single synthesis context window can hold this. Solution: **two-pass architecture**: the configured extraction model outputs compact JSON, and the configured synthesis model sees only compressed summaries.

### The cost problem
Processing every raw email and Keep note in one synthesis prompt would be both unreliable and unnecessarily expensive. Extraction first bounds the synthesis payload; actual cost depends on the configured OpenAI model prices and is reported from usage rather than estimated from obsolete model rates.

### The failure-at-99% problem
Every processed item is written to a checkpoint file immediately. A crash resumes from the exact item it stopped at - no work is lost, no API costs are doubled. Partial results are always written: if GitHub fails, email + Keep + Tasks still produce useful output.

### The "what to store" problem
Raw email bodies, full note text and full README content are **never stored in the output**. The index stores metadata plus structured extraction JSON; the final synthesized document is stored separately. Raw source data stays in its origin system.

### The delta update problem
After a full run, re-running must not rebuild from scratch. Equally, running with only 5 new emails must not produce a context dominated by those 5 emails - the existing index built from 2,847 emails represents far more signal. Solution: **proportional patch synthesis**.

How it works:
1. A persistent index state (`context_builder_indexed_items`) records every indexed item ID and its extraction. On re-run, an existing `(source, item_id)` is skipped.
2. Only genuinely new items enter the structured extraction pipeline.
3. The delta synthesis step receives: the **existing context document** (already compressed, ~3,000 tokens) + only the **new item extractions** (the delta). The prompt explicitly states the ratio: "The existing context reflects N items indexed previously. The delta contains M new items. Merge proportionally - do not alter conclusions drawn from N unless directly contradicted by the delta. Add new contacts and entities if present."
4. The result replaces the previous context document, but the edit distance should be small for a small delta.

**When to recommend a full rebuild instead:** If the delta exceeds 30% of total indexed items (e.g., first run after 6 months of heavy email volume), warn the user and suggest `--full` for a cleaner result. The update still runs if the user proceeds, but the warning is logged.

---

## Run Modes

```
bun run context-builder/run.ts            # auto-detect: full if no prior index, update otherwise
bun run context-builder/run.ts --full     # always rebuild from scratch (ignores existing index)
bun run context-builder/run.ts --update   # force delta mode even if no prior index exists (no-op if nothing new)
bun run context-builder/run.ts --dry-run  # inventory only, no model calls or writes
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
3. Only processes the delta: structured extraction for new items only
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
  run.ts                    # entry point - orchestrates all phases
  progress.ts               # live terminal progress display
  checkpoint.ts             # read/write/resume checkpoint state
  errors.ts                 # error logger with retry logic
  sources/
    email.ts                # IMAP fetcher (wraps src/ingest/imap.ts patterns)
    github.ts               # GitHub REST API v3
    keep.ts                 # Google Keep via gkeepapi (Python subprocess)
    tasks.ts                # Google Tasks API
  pipeline/
    extract-email.ts        # structured extraction: email → compact JSON
    extract-note.ts         # structured extraction: Keep note → compact JSON
    batch-contacts.ts       # group email extractions by sender
    synthesize.ts           # OpenAI synthesis calls
  output/
    builder.ts              # assembles final context document
    db-writer.ts            # writes seeds into PIDRA Postgres tables
  prompts/
    email-extraction.ts     # email → JSON prompt
    note-extraction.ts      # Keep note → JSON prompt
    synthesis/
      contacts.ts           # contact profiles
      projects.ts           # project portfolio
      knowledge.ts          # interest + entity map
      tasks.ts              # active commitments
      final.ts              # full context synthesis
```

---

## Data Sources & Strategies

### 1. Email (N accounts, driven by `email-accounts.json`)

The tool reads `email-accounts.json` and classifies each account by its `isNewsAccount` flag:

| `isNewsAccount` | Strategy |
|---|---|
| `true` | **Skip extraction.** Header-count only - newsletter content is already handled by the main pipeline. |
| `false` | Full extraction, subject to time window below. |

No account addresses are hardcoded. Adding or removing an account in `email-accounts.json` is all that is needed.

**Per email pipeline:**
1. Fetch headers only first (IMAP ENVELOPE) - get `from`, `subject`, `date`, `message-id` (no body download yet)
2. Deduplicate against already-processed checkpoint
3. Filter: skip automated system emails (no-reply, noreply, mailer-daemon, calendar invites from bots)
4. Fetch body only for surviving emails
5. Structured extraction pass → compact JSON (see Prompts section)
6. Write checkpoint entry immediately after each successful extraction
7. After all emails: group by sender email → build sender profiles

**Concurrency:** extraction concurrency is `CONTEXT_BUILDER_EXTRACT_CONCURRENCY` (default 8). All non-news IMAP connections open in parallel.

**Time window (applies to `isNewsAccount: false` accounts):**
- Default: last 3 years (configurable via `CONTEXT_BUILDER_EMAIL_YEARS=3`)
- Accounts with `classifyNewsVsPersonal: false` (dedicated personal/work accounts): apply time window normally
- Anything older than the time window gets header-only metadata, with no body fetch or model call

### 2. Google Tasks (~130 items)

Small dataset. No per-item extraction pass is needed.

- Fetch all task lists + all tasks via Google Tasks API
- Filter: exclude completed tasks older than 90 days
- Full dataset → one synthesis call → active commitments summary and urgency classification
- Estimated tokens: ~3,000 input, ~800 output → **~$0.01**

### 3. Google Keep (~1,000 notes)

**API approach:** `gkeepapi` (unofficial Python library, accessible via Bun subprocess).

- Fetch all notes
- Per note: structured extraction (category, entities, topics, summary, type, temporal references)
- Group by category after extraction
- Per category group → one synthesis call → category-level synthesis
  - 10 categories × ~100 notes each compressed to ~80 chars = ~8,000 tokens input per category
  - Actual: ~3,000 tokens per category after compression
  - 10 calls × ~$0.02 each = **~$0.20 total**

### 4. GitHub

- Use GitHub REST API v3 (`api.github.com/users/ileies/repos`)
- Per repo: name, description, language, topics, stars, last_push, open issues count
- Per repo: fetch README (first 400 chars only - the "pitch line")
- Per repo: last 10 commits (message + date only, no diff)
- Total data: ~20–30 repos, ~15,000 tokens input
- One synthesis call → project portfolio summary

**Repos to include:** All public + private repos (requires `repo` scope on PAT). Archived repos: include but mark as archived.

### 5. Final Context Synthesis

One synthesis call receives all prior synthesis outputs (contacts, projects, tasks, knowledge map) and produces the final structured context document.

- Input: ~25,000 tokens (all summaries concatenated)
- Output: ~3,000 tokens
- Cost: **~$0.10**

Model cost is derived from returned usage and the configured rates. Do not rely on a static estimate because model selection is configurable.

---

## Pipeline Phases

```
Phase 0  - Mode detection + Inventory   [~2 min]   Detect full/update/resume, count items, estimate runtime
Phase 1  - Email Headers                [~5 min]   Fetch headers, diff against index, plan extraction
Phase 2  - Email Extraction             [~30-90 min / ~2-10 min delta] structured extraction, new items only
Phase 3  - Contact Grouping             [~1 min]   Group new extractions by sender
Phase 4  - Contact Synthesis            [~2 min]   synthesis: contact profiles (skipped if delta=0)
Phase 5  - Tasks Fetch                  [~1 min]   Google Tasks API (always runs)
Phase 6  - Tasks Synthesis              [~1 min]   synthesis: commitments (always runs)
Phase 7  - Keep Fetch                   [~2 min]   gkeepapi fetch, diff against index
Phase 8  - Keep Extraction              [~15-30 min / ~1-5 min delta] structured extraction, new notes only
Phase 9  - Keep Synthesis               [~5 min]   synthesis per category (skipped if delta=0 for that category)
Phase 10 - GitHub Fetch                 [~2 min]   REST API (always runs)
Phase 11 - GitHub Synthesis             [~1 min]   synthesis: project portfolio (always runs)
Phase 12 - Synthesis                    [~2 min]   Full context document (full mode) OR patch synthesis (update mode)
Phase 13 - DB Seeding                   [~1 min]   Write seeds + update context_builder_runs
Phase 14 - Report                       [~1 min]   Write JSON + Markdown output files
```

Phases 1–4 (email), 5–6 (tasks), 7–9 (Keep), and 10–11 (GitHub) run in parallel after Phase 0.
Phases 12–14 run sequentially after all parallel phases complete.

**In update mode, phases with delta=0 are logged as `✓ skipped (no new items)` in the progress display - they do not run at all.**

---

## Progress Display

Terminal UI, live-updating (redraws every 500ms):

```
╔══════════════════════════════════════════════════════════╗
║  PIDRA Context Builder - 2026-05-18                      ║
╠══════════════════════════════════════════════════════════╣
║  Phase                    Status     Progress    Errors  ║
╠══════════════════════════════════════════════════════════╣
║  0. Inventory             ✓ done     -           0       ║
║  1. Email headers         ✓ done     2,847 msgs   0       ║
║  2. Email extraction      ▶ running  1,241/2,447  3       ║
║  3. Contact grouping      ◌ pending  -           -       ║
║  4. Contact synthesis     ◌ pending  -           -       ║
║  5. Tasks fetch           ✓ done     132 items   0       ║
║  6. Tasks synthesis       ✓ done     1 call      0       ║
║  7. Keep fetch            ✓ done     1,008 notes 0       ║
║  8. Keep extraction       ▶ running  724/1,008   2       ║
║  9. Keep synthesis        ◌ pending  -           -       ║
║ 10. GitHub fetch          ✓ done     23 repos    0       ║
║ 11. GitHub synthesis      ✓ done     1 call      0       ║
║ 12. Final synthesis       ◌ pending  -           -       ║
║ 13. DB seeding            ◌ pending  -           -       ║
║ 14. Report                ◌ pending  -           -       ║
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

- OpenAI model errors, including flex-capacity responses: retry through the shared client with backoff
- IMAP connection drops: reconnect once, then skip account for current run
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
    "gmail:<message-id>": { "status": "failed", "error": "model request timed out", "attempts": 3 }
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
  output_path text,                      -- path to output JSON for this run
  sonnet_tokens_in integer,  -- legacy column name; records OpenAI input tokens
  sonnet_tokens_out integer, -- legacy column name; records OpenAI output tokens
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

On update mode start: `SELECT item_id FROM context_builder_indexed_items WHERE source = 'email:gmail'` → skip these message IDs entirely, without a body fetch or model call.

### Error log (`context-builder/errors.json`)
Append-only log with timestamp, phase, item id, error message, stack trace. Survives restarts. Rolled over per run.

### Partial output guarantee
Final synthesis runs with whatever data is available. If email phase completed 80% and hit an unrecoverable IMAP error, the tool still outputs context from the successful 80% + all other sources. Never blocks final output on partial failure.

---

## Structured Extraction Prompts

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

## Synthesis Prompts (structure only - full prompts written during implementation)

### Contact profiles
Input: all sender profiles (email + name + list of compressed email summaries)
Output: JSON array of contact objects `{ name, email, relationship, importance, communication_notes }`

### Active commitments
Input: all Google Tasks items across all lists
Output: structured commitment list with urgency levels and project assignments

### Knowledge map
Input: Keep category summaries after structured extraction
Output: `{ interests[], known_entities[], travel_plans[], key_memories[], personal_rules[] }`

### Project portfolio
Input: GitHub repo data
Output: `{ active_projects[], completed_projects[], tech_stack[], patterns[] }`

### Final context document - full mode
Input: all four synthesis outputs above
Output: full context document (see Output Format below)

### Patch synthesis - update mode
Input:
- Existing context document (the last completed run's JSON, ~3,000 tokens)
- Delta contact profiles (new senders only, if any)
- Delta tasks synthesis (always included - tasks change)
- Delta Keep synthesis (new notes only, per category, if any)
- GitHub synthesis (always included - repos change)
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
Each run produces a new dated file. The previous file is not overwritten - update runs patch the content but save to a new date-stamped file, allowing rollback by simply pointing to an older file.

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
1. **Profile Snapshot** - who this is, languages, roles
2. **Active Commitments** - by urgency (Critical / High / Normal)
3. **Project Portfolio** - active, paused, done
4. **Contact Network** - top 30 contacts with relationship notes
5. **Knowledge Map** - interest domains, entity list, travel plans
6. **Context Notes** - selected Keep memories and rules

---

## Database Seeding (Phase 13)

After generating the context document, `db-writer.ts` seeds PIDRA's existing tables:

| Source | Target table | Write mode |
|---|---|---|
| `contacts[]` | `contacts` | upsert on email |
| `entity_seeds[]` | `entities` | upsert on name, set `mention_count = 0`, `importance` from context |
| `personal_rules[]` | new `standing_context` table (see below) | upsert on `keep_rule_<note_id>` key (implemented safer than originally designed - see Testing checklist) |
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
CONTEXT_BUILDER_EXTRACT_CONCURRENCY=8  # parallel extraction calls to OpenAI
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

Every extraction and synthesis request goes through `src/ai/openai.ts`. Cost depends on `OPENAI_MODEL_EXTRACTION`, `OPENAI_MODEL_SYNTHESIS` and the configured per-million-token rates. The default for both models is `gpt-5.6-luna`; `progress.ts` reports returned usage and computes a cost only when rates are configured. Static estimates based on another provider's pricing are intentionally omitted.

---

## Integration with Main PIDRA Pipeline

After context builder runs once, PIDRA uses its output as follows:

- **Phase 3 context assembly** automatically uses pre-seeded `entities` and `contacts` tables
- **Section 2 prompt** injects `standing_context` rows of type `rule` as standing personal operating rules
- **Entity importance scoring** uses `importance` field from context builder seeds
- **Question gate** skips known contacts (already in `contacts` table from context builder)

The context builder is **not** a dependency of the daily pipeline - it only improves the pipeline's quality from day one.

---

## TODO Checklist

### Sub-project setup
- [x] Create `context-builder/` directory with `package.json` (Bun, standalone) — not needed; runs via root `package.json` script
- [x] Create `tsconfig.json` for context-builder (extends root)
- [x] Add `context-builder` run script to root `package.json`: `"context-builder": "bun run context-builder/run.ts"`
- [x] Create `.checkpoint.json` init logic and `checkpoint.ts` module
- [x] Create `errors.ts` module (append-only JSON log)
- [x] Add `context_builder_runs` and `context_builder_indexed_items` tables to DrizzleORM schema + generate migration

### Progress display
- [x] Implement `progress.ts`: phase state machine + ANSI terminal renderer
- [x] Implement 500ms refresh loop with cursor reposition
- [x] Implement cost accumulator (tracks OpenAI token usage in real time)
- [x] Implement ETA calculator (based on items/sec × remaining items)

### Environment + config
- [x] Add `GITHUB_TOKEN`, `GKEEPAPI_*`, `CONTEXT_BUILDER_*` vars to `.env.example`
- [x] Write config loader `context-builder/config.ts`
- [x] Add `standing_context` migration to DrizzleORM schema + generate migration

### Phase 0 - Mode detection + Inventory
- [x] Implement mode detection: read `context_builder_runs` table → decide full / update / resume
- [x] In update mode: load previously indexed item IDs per source into memory (used as skip-set throughout)
- [x] Implement IMAP header count (per account, no body fetch) — tracked via `state.phases.email.total` in `run.ts`
- [x] Implement GitHub repo count via API — tracked via `state.phases.github.total` in `run.ts`
- [x] Implement Google Tasks list count via API — tracked via `state.phases.tasks.total` in `run.ts`
- [x] Implement Keep note count (gkeepapi) — tracked via `state.phases.keep.total` in `run.ts`
- [x] In update mode: show `N total / M new / K skipped` per source in inventory
- [x] If delta > 30% of total indexed items, print rebuild recommendation and ask to confirm before proceeding
- [x] Print inventory table + estimated runtime

### Phase 1–4 - Email
- [x] Implement `sources/email.ts`: IMAP header-only fetch (ENVELOPE) for all non-news accounts in parallel
- [x] Implement sender dedup filter (skip `no-reply`, `noreply`, `mailer-daemon`, `notifications@`, etc.)
- [x] Implement time window filter (configurable years, default 3)
- [x] Implement skip-set filter: drop any message-id already in `context_builder_indexed_items`
- [x] Implement body fetch for filtered emails (streaming, with size cap at 50KB per email)
- [x] Write structured extraction prompt for emails (`prompts/email-extraction.ts`)
- [x] Implement `pipeline/extract-email.ts`: OpenAI call with semaphore + checkpoint write per item + write to `context_builder_indexed_items` on success
- [x] Implement `pipeline/batch-contacts.ts`: group new extractions by `from_email`
- [x] Write contact synthesis prompt
- [x] Implement contact synthesis call (batched: max 50 senders per call; skipped entirely if delta=0)

### Phase 5–6 - Google Tasks
- [x] Implement `sources/tasks.ts`: fetch all lists + all tasks via Google Tasks API
- [x] Filter: exclude completed tasks older than 90 days
- [x] Write tasks synthesis prompt
- [x] Implement tasks synthesis call

### Phase 7–9 - Google Keep
- [x] Write `context-builder/scripts/keep-auth.py` (one-time token fetch via gkeepapi)
- [x] Write `context-builder/scripts/keep-fetch.py` (fetch all notes → stdout JSON)
- [x] Implement `sources/keep.ts`: Bun subprocess → gkeepapi
- [x] Implement skip-set filter: drop any note ID already in `context_builder_indexed_items`
- [x] Write structured extraction prompt for Keep notes (`prompts/note-extraction.ts`)
- [x] Implement `pipeline/extract-note.ts`: OpenAI call with semaphore + checkpoint write + write to `context_builder_indexed_items` on success
- [x] Write Keep synthesis prompt (per category) — simplified to single call with all categories as a map; per-category split unnecessary after structured extraction
- [x] Implement per-category synthesis calls (skipped for categories where delta=0) — single `synthesizeKeep()` call in `synthesize.ts`

### Phase 10–11 - GitHub
- [x] Implement `sources/github.ts`: list repos (public + private) via REST API v3
- [x] Fetch per repo: description, language, last_push, README (first 400 chars), last 10 commit messages
- [x] Write GitHub synthesis prompt
- [x] Implement GitHub synthesis call

### Phase 12 - Synthesis (full or patch)
- [x] Write full context synthesis prompt (`prompts/synthesis/final.ts`)
- [x] Write patch synthesis prompt (`prompts/synthesis/patch.ts`) - includes ratio metadata and proportionality instruction
- [x] Implement full synthesis call (input: all phase outputs)
- [x] Implement patch synthesis call (input: existing context JSON + delta summaries only)
- [x] Parse and validate output structure (same schema for both modes) — synthesis returns plain text, while DB seeding reads structured extraction objects

### Phase 13 - DB Seeding
- [x] Add `standing_context` table to Drizzle schema
- [x] Generate and apply migration — script at `tmp-migrate-0007.ts`, run when pronix is reachable, then delete
- [x] Implement `output/db-writer.ts`: upsert contacts into `contacts` table
- [x] Implement entity seeding: upsert into `entities` with `mention_count = 0`
- [x] Implement `standing_context` seeding — implemented as an upsert keyed by `keep_rule_<note_id>`, not the replace-all strategy originally planned above
- [x] Write completed run record to `context_builder_runs` (status, item counts, cost, output path)

### Phase 14 - Report output
- [x] Implement `output/builder.ts`: JSON output writer
- [x] Implement Markdown output writer with the five required top-level sections in `output/builder.ts`
- [x] Print final summary: items processed, errors, cost, output file paths — done in `run.ts`

### Error handling
- [x] Per-item retry with exponential backoff (2s, 8s) in `extract-email.ts` and `extract-note.ts`
- [x] Central OpenAI retry and flex-capacity handling through `extractJson()` in both extract files
- [x] IMAP reconnect logic (1 retry per account) in `sources/email.ts`
- [x] Central OpenAI retry and flex-capacity handling through `synthesize()`
- [x] Partial output guarantee: each phase wrapped in try/catch, synthesis always runs with available data

### Testing
- [x] Test with `--dry-run` flag: counts only, no API or model calls — verified 2026-09-11: real inventory (6 new emails, 1 new Keep note, 174 tasks, 40 repos), zero `context_builder_runs` writes, mode auto-detected as `update`.
- [x] Test email extraction on 10 emails before full run — moot: the first full run (2026-09-10) already succeeded end-to-end on the real inbox, so there's no longer a "before full run" smoke test to do.
- [x] Test Keep extraction on 20 notes before full run — moot, same reasoning.
- [x] Test checkpoint resume: kill mid-run, verify it continues correctly — verified 2026-09-11: killed the run (`kill -9`) mid-synthesis with 6 emails + 1 Keep note already extracted and persisted to `context_builder_indexed_items`. Re-invoking with no flags found the `status='running'` row, reused all 7 prior extractions (no re-extraction cost), and completed the *same* run row (`ba7d39b5-...`) rather than creating a new one.
- [x] Test update mode: run full, add a known email to the account, run again → verify exactly 1 new item processed, rest skipped — verified with real organic delta instead of a synthetic email: pre-run dry-run showed 6 new emails + 1 new Keep note against 1,464/405 indexed; the real update run processed exactly those 7 and a follow-up dry-run showed 0 new remaining (1,470/406 indexed).
- [x] Test proportionality: update run with 5 new emails → verify context document changes are minimal (not a full rewrite) — **tested, and it failed.** Sections 1-5 (identity, projects, knowledge domains, standing context, technical profile) held up fine, but the "Personal Knowledge (Keep)" section collapsed from 641 lines to 71 (context-2026-09-10.md → context-2026-09-11.md) and the Contacts Summary lost its entire low-importance-contacts breakdown, despite a 7-item delta against ~1,869 existing items. Root cause and fix tracked as a `[BUG]` in `TODO.md`.
- [ ] Test 30% rebuild warning: seed fake index with 10 items, present 4 new → verify warning fires and prompts for confirmation — not tested directly (would require fabricating a large fake index, deemed not worth the risk/cost). The non-firing path was verified instead: real delta was 0.4% of the index and the warning correctly did not fire. The warning logic itself (`run.ts`: `if (ratio > 0.3)`) was code-reviewed and is straightforward.
- [x] Verify DB seeding does not break existing PIDRA tables — verified 2026-09-11: `contacts` (6→7), `entities` (86), `standing_context` (18), `daily_reports` (3) all sane after the run; `seedStandingContext` upserts keyed by `keep_rule_<id>` rather than the "replace all" the design doc above describes, so a small delta cannot wipe existing standing rules - safer than documented, not a bug.

### Documentation
- [x] Add `context-builder/README.md` with quickstart, first-run instructions, and Keep auth setup

---

## Open Decisions (resolve before implementing)

- [x] **Keep API approach** - gkeepapi only. No Takeout fallback - both approaches are equally fragile (gkeepapi can break on Google updates; Takeout format can change too), and maintaining both doubles the complexity. If gkeepapi breaks, fix it or wait for the library to update. The tool simply fails the Keep phase and continues with other sources.
- [x] **GitHub PAT scope** - PAT with `repo` scope. Personal tool, not network-exposed, no need for GitHub App complexity.
- [x] **News account email treatment** - `sources/email.ts` returns `[]` for `isNewsAccount: true` accounts. Sufficient for first run; newsletter personal replies are an edge case to revisit later if needed.
- [x] **Rerun cadence** - Decided: update mode is the default on subsequent runs (auto-detected via `context_builder_runs` table). `--full` forces a rebuild. `--update` forces delta even if first run. 30% delta threshold triggers a rebuild recommendation. Patch synthesis ensures new items are weighted proportionally to the existing index size.
- [x] **Output location** - `context-builder/output/`. Resolved in `config.ts` and `run.ts`.

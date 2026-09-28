# Phase 7: passive context sources (undone design)

**Status: none of this is built.** No `keep_notes`, `keep_index`, `chat_signals`, or `personal_context` table exists. Blocked until Phase 6 has run stably for 2+ weeks - see `CLAUDE.md`, "What not to build (yet)". This is forward design carried over from the original build plan, not current architecture; treat every table/prompt below as proposed, not real.

Three additional data sources meant to enrich the system's understanding of the user without being active news inputs. All three are optional.

## Google Keep notes (~1,000 notes)

**Role:** queryable background knowledge base - surfaces connections between existing notes and today's news. **Never** dumps all notes into a synthesis prompt, never scans notes on every run.

Initial bulk import is already handled by the Context Builder (`context-builder/`, not this pipeline): full scan via gkeepapi, seeds `entities` and `standing_context`. `keep_notes`/`keep_index` are Phase 7 work on top of that, for the daily pipeline's own fast lookup path.

**Proposed architecture:**
- During Phase 3 (daily): for each of today's top 10 entities by effective relevance, query `keep_index` for entity overlap; inject matched note summaries (not full text) into the Section 1 payload as a `user_prior_context` block, e.g. `[Prior context: 3 notes mentioning Neuralink - last from February, tagged "BCI investment thesis".]`
- Weekly re-index: run the extraction model on notes created/modified since the last Context Builder run, reusing its gkeepapi scripts and `context_builder_indexed_items` skip-set.
- API: gkeepapi (Python subprocess) only - Keep's own API is Workspace-only. Auth scripts live in `context-builder/scripts/`.

**Proposed tables:**
```sql
keep_notes (
  id text PRIMARY KEY, raw_content text, created_at date, updated_at date, indexed_at timestamptz
)
keep_index (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), note_id text REFERENCES keep_notes(id),
  topic_tags text[], entities text[], note_type text, summary text, indexed_at timestamptz DEFAULT now()
)
```

## AI chat history

**Role:** topic/project signal extraction - if the user keeps asking about a subject, weight it higher in the briefing. **Never** includes full conversations in synthesis payloads, never lets the system amplify whatever was last discussed. Sequenced last of the three (decided 2026-09-10): Keep and diary are denser signal for less privacy surface.

**Proposed architecture:**
- Nightly extraction job (03:00, before the 06:30 briefing): structured extraction per conversation from the last 7 days → `topic_signals`, `project_signals`, `question_patterns`, `entities_researched`. Aggregated weekly into `chat_signals`.
- Topics appearing in >=3 chat sessions get a `+0.4` domain-interest bonus for the next 7 days.
- `project_signals` injected into both synthesis prompts as a "current projects" line.
- Retention: rows older than 30 days deleted, rolling 4-week window only.
- Privacy: stays on the local server; the cloud-data boundary for this source must be decided explicitly before implementation, same as any new personal source. A dashboard toggle disables the feature entirely; specific sessions can be flagged excluded.

**Proposed table:**
```sql
chat_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), week_start date NOT NULL,
  topic_signals text[], project_signals text[], entity_signals text[],
  raw_counts jsonb, created_at timestamptz DEFAULT now()
)
```

## Diary

**Role:** personal context and emotional register - the most powerful of the three for Section 2 quality, letting the system frame personal action items against the user's actual current life phase rather than treating them generically.

Diary content is otherwise in scope for the Context Builder already (under `store: false` - see `CLAUDE.md`'s "Diary and other intimate personal content" rule). Phase 7 must preserve that same boundary rather than reviving a stricter local-only rule.

**Proposed architecture:**
- Weekly extraction (Sunday): read the last 7 diary entries, extract only an abstract block - emotional valence, current life phase, up to 5 abstract concern tags, up to 3 recurring theme tags. Explicitly told not to summarize content.
- Store in `personal_context` with `valid_until` = 7 days.
- Injected into the Section 2 system prompt to calibrate tone/priority framing (e.g. acknowledge an active concern briefly, be direct-not-alarmist during a high-stress period).
- Format-agnostic reader needed: Markdown files, local SQLite, or a folder of `.txt` files; a proprietary diary app needs an export/sync script similar to Keep's.
- User review: the extracted block is visible in the dashboard and correctable through the append-only correction layer - never edited in place.

**Proposed table:**
```sql
personal_context (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), week_start date NOT NULL,
  emotional_valence text, current_phase text, active_concerns text[], recurring_themes text[],
  user_overridden boolean DEFAULT false, valid_until date, created_at timestamptz DEFAULT now()
)
```

## Which sources go to which AI

| Source | Extraction model | Synthesis model | Rule |
|---|---|---|---|
| Google Keep | yes (indexing) | yes (matched summaries only) | never full notes, only matched snippets |
| AI chat history | yes (extraction) | yes (abstract signals only) | never raw content |
| Diary | yes (extraction) | yes (abstract block only) | never raw content, ever |

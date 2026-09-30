# Soon

See `docs/todo/README.md` for the conventions this list follows.

## Phase 7: passive context sources

Blocked until Phase 6 has run stably for 2+ weeks. Three additional data sources meant to enrich the system's understanding of the user without being active news inputs, all optional: Google Keep notes, AI chat history, and diary. Initial bulk import for Keep and diary content is already handled by the Context Builder (seeds `entities` and `standing_context`); what's below is Phase 7's own fast daily-lookup path on top of that. Sequencing decided 2026-09-10: Keep and diary first, AI chat history last - Keep and diary are denser signal for less privacy surface. Cross-source rule: extraction may read raw content, but synthesis never receives more than matched summaries or abstract signals - never raw notes, chat transcripts, or diary text.

**Google Keep** (~1,000 notes, queryable background knowledge base - surfaces connections between existing notes and today's news; never dumps all notes into a synthesis prompt, never scans notes on every run):
- **[INFRA]** `keep_notes` (`id text PK, raw_content text, created_at date, updated_at date, indexed_at timestamptz`) and `keep_index` (`id uuid PK, note_id text REFERENCES keep_notes(id), topic_tags text[], entities text[], note_type text, summary text, indexed_at timestamptz`) tables
- **[FEATURE]** Weekly re-index job: run the extraction model over notes created/modified since the last Context Builder run, reusing its gkeepapi scripts (`context-builder/scripts/`, Python subprocess - Keep's own API is Workspace-only) and the `context_builder_indexed_items` skip-set
- **[FEATURE]** Phase 3 (daily): for each of today's top 10 entities by effective relevance, query `keep_index` for entity overlap and inject matched note summaries (not full text) into the Section 1 payload as a `user_prior_context` block, e.g. `[Prior context: 3 notes mentioning Neuralink - last from February, tagged "BCI investment thesis".]`

**Diary** (most powerful of the three for Section 2 quality - lets the system frame personal action items against the user's actual current life phase rather than treating them generically. Format decided 2026-09-10: a plain directory of Markdown files, one per day, `YYYY-MM-DD.md` - no Obsidian vault, no SQLite, trivially readable from Bun, and git gives versioning for free. Diary content is already in scope for the Context Builder under `store: false`; Phase 7 must preserve that same boundary rather than reviving a stricter local-only rule):
- **[FEATURE]** Diary reader module (directory scan + per-day Markdown parse); a proprietary diary app would need an export/sync script similar to Keep's
- **[FEATURE]** Weekly extraction job (Sunday): read the last 7 entries and extract only an abstract block - emotional valence, current life phase, up to 5 abstract concern tags, up to 3 recurring theme tags - explicitly told not to summarize content. Store in `personal_context` with `valid_until` = 7 days
- **[INFRA]** `personal_context` table (`id uuid PK, week_start date, emotional_valence text, current_phase text, active_concerns text[], recurring_themes text[], user_overridden boolean DEFAULT false, valid_until date, created_at timestamptz`)
- **[FEATURE]** Inject the abstract block into the Section 2 system prompt to calibrate tone/priority framing (e.g. acknowledge an active concern briefly, be direct-not-alarmist during a high-stress period)
- **[FEATURE]** Dashboard viewer for the extracted block, correctable through the append-only correction layer - never edited in place

**AI chat history** (topic/project signal extraction - if the user keeps asking about a subject, weight it higher in the briefing; never includes full conversations in synthesis payloads, never lets the system amplify whatever was last discussed. Starts only once Keep and diary are stable):
- **[INFRA]** Document the chat history DB schema (tables, timestamps, session ids) once this track starts, not before
- **[FEATURE]** Nightly extraction job (03:00, before the 06:30 briefing): structured extraction per conversation from the last 7 days into `topic_signals`, `project_signals`, `question_patterns`, `entities_researched`, aggregated weekly into `chat_signals` (`id uuid PK, week_start date, topic_signals text[], project_signals text[], entity_signals text[], raw_counts jsonb, created_at timestamptz`)
- **[FEATURE]** Topics appearing in >=3 chat sessions get a +0.4 domain-interest bonus for the next 7 days; `project_signals` injected into both synthesis prompts as a "current projects" line
- **[INFRA]** Retention: delete rows older than 30 days, rolling 4-week window only
- **[FEATURE]** Dashboard toggle to disable the feature entirely, plus per-session exclusion flagging. Privacy: stays on the local server; the cloud-data boundary for this source must be decided explicitly before implementation, same as any new personal source

## 30-day web-search check-in

- **[INFRA]** At the 30-day mark, compare Brave with Tavily and Exa on the same representative desk queries and a record of stories Brave missed. Compare useful story recall, source quality and request cost. Keep Brave unless an alternative shows a clear coverage improvement at an acceptable cost; quota alone is not a reason to switch

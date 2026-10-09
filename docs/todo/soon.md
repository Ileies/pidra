# Soon

See `docs/todo/README.md` for the conventions this list follows.

- **[FEATURE]** Questions queue: a "topic/desk drift" candidate source. Ask only when a news desk's items are measurably and consistently rated low over time, never on a fixed interval. Needs enough real ratings (`feedback_events`) and quick-action outcomes (`report_actions`) to measure first, which depends on the week of use in `docs/todo/user.md`. It then joins the queue like the existing candidate sources (`src/pipeline/stale-context-questions.ts`)

## Phase 7: passive context sources

Blocked until Phase 6 has run stably for 2+ weeks. Three optional sources that enrich the system's understanding of the reader without being news inputs. Order: Keep, then diary, then AI chat history last (Keep and diary are denser signal for less privacy surface). The Context Builder already does the initial bulk import of Keep and diary content into `entities` and the `notes` rules; Phase 7 adds a fast daily-lookup path on top.

**Cross-source rule:** extraction may read raw content, but synthesis never receives more than matched summaries or abstract signals - never raw notes, chat transcripts or diary text. Every new source needs its own credential/PII filter and drop log (`docs/architecture-rules.md`).

**Google Keep** (~1,000 notes as queryable background knowledge; never dump all notes into a synthesis prompt, never scan them every run):
- **[INFRA]** `keep_notes` (raw content, created/updated dates) and `keep_index` (per-note `topic_tags`, `entities`, `note_type`, `summary`) tables
- **[FEATURE]** Weekly re-index job over notes changed since the last Context Builder run, reusing its gkeepapi scripts (`context-builder/scripts/`) and the `context_builder_indexed_items` skip set
- **[FEATURE]** Daily Phase 3: for each of the top 10 entities by effective relevance, look up `keep_index` by entity and inject matched note summaries (not full text) into the Section 1 payload as a `user_prior_context` block, e.g. `[Prior context: 3 notes mentioning Neuralink - last from February, tagged "BCI investment thesis".]`

**Diary** (the strongest signal for Section 2: personal action items framed against the reader's current life phase). Format decided 2026-09-10: a directory of Markdown files, one per day, `YYYY-MM-DD.md`, versioned by git. Diary content is already in scope for the Context Builder under `store: false`, and Phase 7 keeps that same boundary:
- **[FEATURE]** Diary reader (directory scan, per-day parse); a proprietary diary app would need an export script like Keep's
- **[FEATURE]** Weekly extraction (Sunday) of the last 7 entries into an abstract block only: emotional valence, current life phase, up to 5 concern tags, up to 3 recurring theme tags, explicitly not a summary of content. Stored in a new `personal_context` table with `valid_until` = 7 days and a `user_overridden` flag
- **[FEATURE]** Inject the block into the Section 2 system prompt to calibrate tone and priority framing
- **[FEATURE]** Dashboard viewer for the block, corrected through the append-only correction layer, never edited in place

**AI chat history** (topic and project signals: a subject the reader keeps asking about weighs higher; never full conversations in synthesis payloads, never amplify whatever was discussed last). Starts only once Keep and diary are stable:
- **[INFRA]** Document the chat history schema when this track starts, not before
- **[FEATURE]** Nightly job (03:00) extracting per-conversation topic, project, question and entity signals for the last 7 days, aggregated weekly into `chat_signals`. Topics in 3+ sessions get a +0.4 domain-interest bonus for 7 days; project signals go into both synthesis prompts as a "current projects" line
- **[INFRA]** Retention: a rolling 4-week window, rows older than 30 days deleted
- **[FEATURE]** Dashboard toggle to disable the feature, plus per-session exclusion. The cloud-data boundary for this source must be decided explicitly before implementation

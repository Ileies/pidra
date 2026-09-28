# Soon

See `docs/todo/README.md` for the conventions this list follows. This is mostly Phase 7 (passive context sources) - full design in `docs/phase7-passive-context-plan.md` - plus the one non-Phase-7 decision below.

**Phase 7 - Google Keep:**
- **[FEATURE]** Keep notes indexer for the ongoing daily delta (reuses the `context_builder_indexed_items` skip-set). Bulk import is already handled by the Context Builder
- **[FEATURE]** Phase 3 entity → Keep lookup and context injection
- **[INFRA]** `keep_notes` and `keep_index` tables for pipeline use

**Phase 7 - Diary** (format decided 2026-09-10: a plain directory of Markdown files, one per day, `YYYY-MM-DD.md`. No Obsidian vault, no SQLite - no lock-in, trivially readable from Bun, and git gives versioning for free):
- **[FEATURE]** Diary reader module (directory scan + per-day Markdown parse)
- **[FEATURE]** Weekly personal context extraction job (Sunday, abstract only)
- **[FEATURE]** Personal context block injection into the Section 2 prompt
- **[FEATURE]** Personal context viewer/editor in the dashboard
- **[INFRA]** `personal_context` table

**Phase 7 - AI chat history** (decided 2026-09-10: sequence this track *last* of the three Phase 7 sources - Keep and diary are denser signal for less privacy surface, so this one starts only when they are stable):
- **[INFRA]** Document the chat history DB schema (tables, timestamps, session ids) - when the track starts, not before
- **[FEATURE]** Nightly extraction job (03:00) against that database
- **[FEATURE]** `chat_signals` table plus integration with relevance calibration
- **[FEATURE]** Project signal injection into the synthesis prompts
- **[FEATURE]** Dashboard toggle to enable/disable

**At the 30-day mark:**
- **[DECISION]** Evaluate web search quality - upgrade from Brave to Tavily or Exa if insufficient. The trigger is thin results, above all stories the news desks missed, not quota. The old "2,000 calls a month free" figure is gone: Brave now bills $5 per 1,000 requests with $5 of credit a month, so the desks will cost real money once they run on it

# Schema notes

See `src/db/schema.ts` for the full schema - it is the single source of truth and nothing duplicates it.

## Shared configs - don't duplicate

- **Email accounts:** the `email_accounts` table, managed from `/settings/email-accounts` and loaded via `src/config/email-accounts.ts` → `loadEmailAccounts()` (async - it queries Postgres). Both the pipeline and the Context Builder use this. `password` is AES-256-GCM ciphertext (`src/config/crypto.ts`), keyed by `CONFIG_ENCRYPTION_KEY` - a per-machine secret in `.env`, never in the table itself. The dashboard's own writer, `dashboard/src/lib/server/emailAccounts.ts`, is write-only for passwords: a saved one is never read back or shown again, only replaced. Never create a separate email config in `context-builder/`.
- **Newsletter sources:** `newsletter_sender_rules` and `rss_feeds`, managed from `/settings/newsletters` and loaded via `src/config/newsletter-sources.ts` and `src/config/rss-feeds.ts`. The pipeline reads the current rows at the start of each run. `rss_feeds.last_error` and its timestamp show the latest fetch failure under the URL; a successful fetch clears it. The delete action on `/sources` and `/sources/[name]` calls `deleteSource` in `dashboard/src/lib/server/sources.ts`, which writes straight to Postgres and removes a source's rows from `source_quality`, `rss_feeds` and `newsletter_sender_rules` together, same as `/settings/newsletters`' own `deleteFeed`/`deleteSenderRule` - history in `raw_items`/`extractions`/`source_daily_scores` is kept. Enable/disable goes through `setSourceActive` in the same file. The pipeline server's `PATCH`/`DELETE /api/sources/:name` endpoints still exist but the dashboard no longer uses them.
- **DB:** `src/db/index.ts` - re-export everything from there, don't create new DB connections elsewhere.

## Key schema tables

- `raw_items` - all ingested content before processing, including one delivery per news desk per day (`source_type = 'web_news'`, with the desk's queries and consulted URLs in `raw_content`)
- `extractions` - the extraction stage's structured output per item, with effective relevance scores and the Phase 3 gate verdict (`gate_passed`, `gate_reason`, `gate_detail`); a news story carries its checks in `extracted_json.validation`
- `pipeline_run_steps` - span tree per `pipeline_runs` row (`parent_id`, `step`, `attempt`, start/end, `duration_ms`, own tokens, AI calls, searches, flex retries, `detail` JSONB); written by `src/util/trace.ts`, absent for runs before 2026-10-01, deleted with the run
- `ingest_drops` - mail the IMAP ingest discarded before it became a `raw_items` row, with the rule that discarded it
- `active_topics` - running story summaries, continuity across days
- `report_actions` - the quick actions a report offers, with their state (`proposed | running | done | failed | queued | dismissed`, or `discarded` with the reason code threw a proposal out)
- `questions` - the standing question queue (`open | answered | dismissed | resolved | merged`), with the mails behind each question, earlier wordings in `history` and the reason a question was closed; `blocks_until` is unused (Section 2 no longer waits) and kept without a migration
- `question_events` - append-only outcome log for `questions`: one row per asked/reasked/rewritten/answered/dismissed/reopened/merged/resolved/dropped event, with the reason, so history isn't lost when a later event overwrites `questions.status_detail`
- `entities` / `entity_mentions` / `entity_appearances` - entities seen across newsletters and harvested sources, `entity_mentions` as the one-row-per-source provenance behind `mention_count` (dedup'd to one per newsletter, one per harvested item), `entity_appearances` as the timeline of report days an entity was actually cited in
- `source_quality` / `source_daily_scores` - per-source trust scores and 30-day rolling history
- `brave_daily_usage` - atomic shared count of actual Brave API attempts per Europe/Berlin day, capped at 30
- `prompt_versions` - versioned prompts, only one active per section at a time
- `skill_executions` - audit log for all skills-bridge calls
- `standing_context` - persistent rules/preferences injected into Section 2 prompt; seeded by Context Builder from Google Keep "Daily Life Rules" and other standing rules
- `context_builder_runs` / `context_builder_indexed_items` - Context Builder run history (including the harvested document itself, on `document`) and per-item index state; used for delta detection on re-runs
- `context_corrections` - append-only correction layer over the harvested long-term context; injected into both synthesis prompts and authoritative over them
- `chat_conversations` / `chat_messages` - the context revision chat's transcript, and the provenance trail for every correction it made
- `notes` - user and system notes, scoped by `global | intel | personal | contact | search`; editable in place, soft-deleted via `deleted_at`
- `note_revisions` - append-only pre-change state per note mutation, with the skill execution and conversation that caused it; drives the undo and the history panel on `/notes`
- `feedback_events` - explicit +/- ratings and implicit behavioral signals per extraction
- `push_subscriptions` - Web Push VAPID subscriptions for PWA notifications

# Schema notes

`src/db/schema.ts` is the single source of truth for columns; nothing here duplicates it. This file records what each table is for and the cross-cutting rules that are not obvious from the column list.

## Shared configs - don't duplicate

- **Email accounts:** the `email_accounts` table, managed from `/settings/email-accounts` and loaded by the async `loadEmailAccounts()` in `src/config/email-accounts.ts`. Both the pipeline and the Context Builder use it; never create a separate email config in `context-builder/`.
  - `password` is AES-256-GCM ciphertext (`src/config/crypto.ts`), keyed by `CONFIG_ENCRYPTION_KEY`, a per-machine secret in `.env` and never in the table.
  - The dashboard writer (`dashboard/src/lib/server/emailAccounts.ts`) is write-only for passwords: a saved one is never read back or shown, only replaced.
- **Newsletter sources:** `newsletter_sender_rules` and `rss_feeds`, managed from `/settings/newsletters` and loaded by `src/config/newsletter-sources.ts` and `src/config/rss-feeds.ts`. The pipeline reads the current rows at the start of each run. `rss_feeds.last_error` and its timestamp show the latest fetch failure; a successful fetch clears it.
- **Source enable/disable and delete** are dashboard-only writes straight to Postgres (`dashboard/src/lib/server/sources.ts`); the pipeline server has no endpoint for either.
  - `setSourceActive` upserts `source_quality`.
  - `deleteSource` (from `/sources/[name]`) removes the source from `source_daily_scores`, `source_quality`, `rss_feeds` and `newsletter_sender_rules` in one transaction. A later mail from the same sender starts a fresh entry with default trust and no score.
  - `raw_items`, `extractions`, `feedback_events`, `entity_mentions`, `ingest_drops` and `daily_reports` are kept on purpose, so past reports and provenance do not change. Because a source's lifetime stats and delivery list are computed from them by source name, a re-created source's detail page shows its old deliveries.
- **DB:** `src/db/index.ts`. Re-export everything from there and never open a new connection elsewhere.

## Pipeline data

- `raw_items`: all ingested content before processing, including one delivery per news desk per day (`source_type = 'web_news'`, the desk's queries and consulted URLs in `raw_content`).
- `extractions`: the extraction stage's structured output per item, with effective relevance, the Phase 3 gate verdict (`gate_passed`, `gate_reason`, `gate_detail`) and the Section 1 handoff (`synthesis_handoff`, `synthesis_order`). A news story carries its checks in `extracted_json.validation`.
- `ingest_drops`: mail the IMAP ingest discarded before it became a `raw_items` row, with the rule that discarded it.
- `daily_reports`: one row per report date: the markdown (`full_report`, the source of truth), its parsed form (`report_json`, nullable by design), summary, counts and token/search figures.
- `pipeline_runs`: one row per run (`running | completed | failed`), with `failed_step` and `step_errors` (JSONB array of `StepAttemptError`).
- `pipeline_run_steps`: span tree per run (`parent_id`, `step`, `attempt`, timing, own tokens, AI calls, searches, flex retries, `detail` JSONB), written by `src/util/trace.ts`. Absent for runs before 2026-10-01; deleted with the run.
- `active_topics`: running story summaries, giving continuity across days.
- `brave_daily_usage`: atomic shared count of actual Brave API attempts per Europe/Berlin day, capped at 30.
- `report_actions`: the quick actions a report offers, with state `proposed | running | done | failed | queued | dismissed`, or `discarded` with the reason code that threw a proposal out.

## Questions

- `questions`: the standing queue.
  - `status`: `open | answered | dismissed | resolved | merged`. `kind`: `item | review | chat` (the last asked by the assistant).
  - Also holds the mails behind each question, earlier wordings in `history`, and the reason a question was closed.
  - `answer_status` (`running | done | failed`), `answer_outcome` and `answer_conversation_id` record what the assistant did with the answer; they are null for open, closed-without-answer and review questions.
  - `blocks_until` is unused (Section 2 no longer waits), kept to avoid a migration.
- `question_events`: append-only outcome log, one row per asked / reasked / rewritten / answered / dismissed / reopened / merged / resolved / dropped event with its reason, so history survives a later event overwriting `questions.status_detail`.

## Entities, contacts and sources

- `entities` / `entity_mentions` / `entity_appearances`: entities seen across newsletters and harvested sources. `entity_mentions` is the one-row-per-source provenance behind `mention_count` (one per newsletter, one per harvested item); `entity_appearances` is the timeline of report days an entity was actually cited in.
- `contacts`: the email sender directory. `removed_at` marks a contact the owner had removed (row kept and locked, every reader skips it, reverting the correction clears it).
- `source_quality` / `source_daily_scores`: per-source trust scores and 30-day rolling history.

## Context and corrections

- `standing_context`: persistent rules and preferences injected into the Section 2 prompt; seeded by the Context Builder from Google Keep "Daily Life Rules" and other standing rules.
- `context_builder_runs` / `context_builder_indexed_items`: Context Builder run history (including the harvested document itself, on `document`) and per-item index state used for delta detection on re-runs.
- `context_corrections`: append-only correction layer over the harvested context; injected into both synthesis prompts and authoritative over them.
- `notes`: user and system notes, scoped `global | intel | personal | contact | search`; editable in place, soft-deleted via `deleted_at`, optional `expires_at` (live through that day; readers skip expired notes).
- `note_revisions`: append-only pre-change state per note mutation, with the skill execution and conversation that caused it; drives undo and the history sheet on `/notes`.

## Assistant, skills and settings

- `chat_conversations` / `chat_messages`: the assistant's transcripts, with the page context each turn was taken on and the provenance trail for every change it made.
- `skill_executions`: audit log for every skill call (bridge, pipeline, chat, quick actions), including rejections.
- `disabled_skills`: skills switched off from `/skills`.
- `prompt_versions`: versioned prompts, one active per section at a time.
- `user_settings`: one row (`id = 1`) of owner preferences: `ui_language` and `content_language` as two-letter codes, `CHECK`-constrained so free text is impossible. Read through `src/settings/store.ts`, which resolves each code against `src/config/languages.ts` and falls back to the default for a missing row or a retired code.
- `feedback_events`: explicit +/- ratings and implicit behavioral signals per extraction.

## Auth and notifications

- `auth_credentials`, `auth_pin`, `auth_sessions`: passkeys, the PIN hash and hashed session tokens (see `docs/security.md`).
- `push_subscriptions`: Web Push (VAPID) subscriptions for the installed app.
- `notification_reads`: acknowledgements for dashboard notifications, which are projections of reports, open questions and pipeline runs.

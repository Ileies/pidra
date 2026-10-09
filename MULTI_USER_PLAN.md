# Multi-user PIDRA plan

Status: proposed, 2026-10-07. This is an implementation plan and a decision list, not authorization to build, to charge anyone, or to send other people's personal data to any processor. Nothing here has been started.

Source of this plan: a read-only survey of the schema (`src/db/schema/`, 40 tables), the pipeline and jobs (`src/`), the dashboard (`dashboard/`), the Context Builder, the skills, deployment and ops docs, and `docs/architecture-rules.md`. File references are from that survey. Things the survey could not verify are listed in "Not verified" at the end.

## 1. Where we start

The app is single-tenant at every layer, by design, and the design is consistent:

- No table has a `user_id`, `owner_id` or tenant column. A session row identifies nobody (`auth_sessions` has id, expiry, last-seen, user agent). The gate in `dashboard/src/hooks.server.ts` means "has any valid session", and `locals` has no user object.
- Identity is "whoever configured the `.env`". OpenAI and Brave keys, the single Google OAuth refresh token, the GitHub token, the Keep master token, the SMS secret, the home city and country, the encryption key and the push keys are all process-wide env vars.
- Singletons and global unique keys are everywhere: `user_settings` (`CHECK (id = 1)`), `auth_pin` (delete then insert), `daily_reports.report_date`, `report_audio` (`report_date`, `chapter_key`, `variant`), `entities.name`, `contacts.identifier`, `raw_items.message_id`, `source_quality.source_name`, `rss_feeds.source_name`, `disabled_skills.skill_name`, `brave_daily_usage.day` (capped at 30), `notification_reads.notification_key`, `context_builder_indexed_items (source, item_id)`.
- Every job is a one-shot process with a UTC date as its only argument. There is no run lock, no queue and no per-user loop. Scheduling is systemd timers in the NixOS flake, outside this repo.
- The bridge (`src/server`, port 4000) has no authentication and no caller identity. Loopback binding is its only boundary. The dashboard proxies to it with no user context.
- Data access is two stacks that must change in lockstep: Drizzle on Bun SQL (`src/db/index.ts`, used by the pipeline, bridge and Context Builder) and hand-written `postgres` tagged-template SQL in about 29 dashboard modules (`dashboard/src/lib/server/`).
- There is no migration history. `migrations/` is empty, `drizzle-kit migrate` reportedly hangs, and schema changes are applied with a throwaway Bun script (`docs/operations.md`).
- Postgres runs on the same cluster as other services with `trust` auth for the whole LAN, and the app connects as a superuser (`/etc/nixos/hosts/pronix/default.nix`).
- The product itself is written for one reader: prompts say "a single person", the topic taxonomy and relevance rubric encode the owner's interests, priorities live only as `notes` rows, and the 32 newsletters arrive in one mailbox that the owner subscribed.

Consequence: this is a re-architecture of the data model, the auth model, the job model and the trust model, plus a new product layer (signup, billing, onboarding, demo, admin, legal). It is not a feature.

## 2. Target architecture

### 2.1 Decisions this plan assumes (confirm or overturn in Phase 0)

| # | Decision | Recommendation | Why |
|---|---|---|---|
| A1 | Isolation model | One shared Postgres, `user_id` on every per-user table, enforced by a scoped data layer, a repo check script and Postgres row-level security as backstop | Instance-per-customer (own DB, `.env`, systemd units) avoids touching 40 tables, but each customer needs a NixOS rebuild (`docs/operations.md`), shares nothing (newsletter extraction cost times N), and ops cost grows linearly. Keep it only as a fallback for a handful of early customers. |
| A2 | Unit of tenancy | One account = one person. No organizations, teams or invites in v1 | Everything (notes, context, contacts) is a single reader's model. |
| A3 | Shared content | Public content (curated newsletters, RSS, the world and country-level news desks) is ingested and extracted once by the platform and shared read-only. Personal content (personal mail, SMS, Calendar, Tasks, notes, context) is strictly per user | Customers cannot subscribe to 32 newsletters themselves, so a platform-owned subscription inbox is the product. It is also the largest cost lever: newsletters cost 2 model calls each per run today. |
| A4 | Marker for "platform-owned" | `user_id IS NULL` on shared-capable tables (`raw_items`, `extractions`, `email_accounts`, `ingest_drops`, `pipeline_runs`) | One uniform pattern. RLS lets everyone read NULL rows and write none. |
| A5 | Per-user derived state | New `item_verdicts` table: per user gate verdict, trust-weighted score, handoff and report inclusion for any item, shared or private | The per-reader columns on `extractions` (`gate_passed`, `gate_reason`, `gate_detail`, `included_in_report`, `revealed_relevance`, `synthesis_handoff`, `synthesis_order`) cannot live on a shared row. |
| A6 | Auth | Verified email as identity and recovery, passkey as primary credential, PIN demoted to optional app lock or dropped | A SaaS needs signup, verification and recovery. The existing WebAuthn code stays. |
| A7 | Billing | Stripe hosted Checkout plus Customer Portal plus webhooks. Subscription with a trial, plan-based entitlements, hard monthly spend caps | Hosted Checkout keeps card data and third-party scripts off our pages (no CSP script changes). |
| A8 | Scheduling | One scheduler tick (every few minutes) enqueues due users into a Postgres job queue (`FOR UPDATE SKIP LOCKED`). Workers run per-user jobs with global per-provider rate limits | Replaces one systemd timer per job. Tenant provisioning must be data, not a NixOS rebuild. |
| A9 | Run date | `report_date` becomes the user's local calendar date (per-user timezone), not the UTC day | Users in different timezones cannot share a UTC-day key and expect a morning briefing. Platform quotas stay on the UTC day. |
| A10 | Demo | A real demo account with synthetic data, entered without signup through guest sessions that are read-only at the data layer | Cheapest honest demo, and it exercises the real UI and offline layer. |
| A11 | Admin | A separate `admin` role and `/admin` area. Today's global surfaces (`/skills` toggles, `/runs`, prompt approval, source catalog editing, Context Builder controls) become admin-only or user-scoped | They currently expose global state. |
| A12 | Not offered to customers in v1 | Google Keep (unofficial API, manual master token), SMS webhook, system-account `send_email`, `create_file` skill, the `gh auth token` fallback | Not self-serve onboardable, or a cross-tenant risk. They stay available to the owner behind per-user feature flags. |

### 2.2 Data layout in one picture

- Platform layer (user_id NULL): `sources` catalog, newsletter/RSS `raw_items`, their `extractions`, world/country/city desk results, platform ingest drops and runs, prompts baseline.
- User layer (user_id set): everything about one reader. Verdicts, reports, entities, contacts, notes, questions, chat, context, feedback, settings, credentials, subscriptions to catalog sources, usage.
- Shared items flow to users only through `item_verdicts`. A user never reads another user's row. The only cross-user read is shared platform content, and it carries no personal data.

## 3. Cost and capacity model (must be measured before pricing)

Shape of one run for one user today (from the code, no budget config exists):

- Newsletter item: 2 calls (claims extraction plus entity extraction). Personal mail or SMS item: 1 call with the whole contact directory and up to 30 notes in the prompt.
- News desks: 6 desks, about 3 calls each (about 18), plus 27 Brave requests. Slots 1 to 3 add 3 Brave requests for exactly the cap of 30.
- Synthesis: Section 1, Section 2, news editor, quick actions, question reconcile, slot-1 query (about 6 more).
- Weekly: `review` and `meta-run` are 1 call each. Monthly: the Context Builder harvests up to 3 years of mail, which is the single most expensive per-user operation.
- On-demand: chat, `/api/deepen`, TTS (paid, cached in Postgres at roughly 9.6 MB per report).

What multiplication by N does:

- Brave: the cap is one global pool of 30 per UTC day, and every retry reserves another call. With 2 users the second user's desks already fail closed. Pacing is a 1100 ms in-process queue, so 30 searches take at least 33 s, and separate processes would not share it.
- OpenAI flex tier: 429 means "no flex capacity". Under concurrent load flex retries will stack. Rate limits (TPM, RPM) of the account tier will bite.
- Wall clock: a run has a 3 h systemd timeout today. Staggering is mandatory if everyone wants a briefing at 06:30 local.

Sharing savings (A3): the world desk, serendipity desk, country-level talk desk and city-level home desk are computed once per day per (country, city), not per user. Only `beat` and `field` desks and the quick-action, synthesis and question calls are per user. Newsletter and RSS extraction is once per item for everyone.

Actions:

- [ ] Compute the owner's real cost per run for the last 30 days from `pipeline_runs`, `pipeline_run_steps` (token counts exist) and `report_audio` cost columns. This number sets the price floor. Split it into shared and per-user parts.
- [ ] Decide Brave plan and confirm its terms allow serving results to paying customers, its requests-per-second limit, and its monthly quota. Size per-user searches (about 10 for `beat`, `field` and slots) plus shared desks.
- [ ] Confirm OpenAI account tier limits and whether to fall back from flex to the standard tier when flex is unavailable (cost trade-off per plan).
- [ ] Build a per-user usage ledger (`usage_events`: user_id, provider, model, tokens, calls, cost, run_id, kind) written by `src/ai/openai.ts` and `src/search/brave.ts`. All caps and billing read from it.
- [ ] Define plan caps: monthly model spend, chat messages, TTS minutes, email accounts, harvest depth, number of personal desks. A cap hit degrades loudly in the report (the existing "say it out loud" rule), never silently.

## 4. Schema change set

Rules that carry over from the repo: apply additive DDL before deploying code that reads it, drop columns only after the code no longer selects them (`docs/operations.md`). Drizzle selects every column by name, so an early drop breaks old code.

### 4.1 New tables

- `users`: id, email (unique, citext), email_verified_at, role (`user`|`admin`), status (`active`|`suspended`|`deleting`|`demo`), created_at, deleted_at, last_login_at.
- `user_settings` (re-keyed, see 4.2) gains: timezone, delivery_time, home_city, home_region, home_country, also_countries, desks, reasoning_effort override.
- `login_tokens`: email verification and magic-link tokens (hashed, expiry, single use).
- `oauth_connections`: user_id, provider (`google`|`github`), encrypted refresh token, scopes, status (`ok`|`needs_reauth`), last_ok_at, last_error.
- `sources`: the platform catalog (name, kind, feed URL, sender rules, unsubscribe URL and checked_at, base quality, `is_active`, tier). Replaces the global parts of `rss_feeds`, `newsletter_sender_rules` and `source_quality`.
- `user_sources`: user_id, source_name, subscribed, is_active, trust_score, quality_trend.
- `item_verdicts`: user_id, extraction_id, gate_passed, gate_reason, gate_detail, effective_relevance, included_in_report, revealed_relevance, synthesis_handoff, synthesis_order. Unique (user_id, extraction_id).
- `jobs`: id, user_id nullable, kind, run_date, status, attempts, run_after, locked_at, locked_by, error, progress json, priority. Partial unique index on (user_id, kind, run_date) for non-terminal statuses is the run lock.
- `usage_events` (see section 3) and `provider_usage` (day, provider, user_id nullable, calls) replacing `brave_daily_usage`.
- Billing: `billing_accounts` (user_id, stripe_customer_id, plan, status, trial_end, current_period_end, cancel_at), `stripe_events` (event id primary key, for idempotent webhook handling), `plans` or a code constant for entitlements.
- `auth_events`: login, failure, session create and revoke, PIN change, passkey add, email change, deletion request. Also read by the admin view.
- `data_requests`: export and deletion requests with status and timestamps.
- `waitlist` or `invites`: for the closed beta.
- `admin_audit`: every admin action with actor and target.

### 4.2 Existing tables (all 40)

Legend: P = add `user_id` NOT NULL, S = shared-capable (nullable `user_id`), G = stays global, R = re-key or split.

| Table | Disposition | Change |
|---|---|---|
| `auth_credentials` | P | user_id FK. `credential_id` stays unique. Keep `rp_id` scoping for dev and prod. |
| `auth_pin` | P, R | PK becomes user_id, no delete-then-insert singleton. Optional feature. |
| `auth_sessions` | P | user_id FK, `kind` (`user`|`demo`), device label, last IP hash. Session lists scoped by user. |
| `prompt_versions` | G | Admin only. Baseline in code stays. Per-user overrides deferred. Add unique (section, version) and a DB-enforced single active per section (currently a transaction convention). |
| `disabled_skills`, `enabled_skills` | P, R | PK (user_id, skill_name). Platform-level kill switch and default-enabled policy stay in code. |
| `skill_executions` | P | user_id. Holds full params and results, which are personal data. |
| `user_settings` | R | PK user_id, drop `CHECK (id = 1)`, add profile columns (4.1). Fix `WHERE id = 1` and `ON CONFLICT (id)` in `src/settings/store.ts` and `dashboard/src/lib/server/settings.ts`. |
| `email_accounts` | S, R | user_id (NULL = platform news inbox). Unique (user_id, host, user). Per-user data key for the password. Add connection health columns and `needs_reauth`. |
| `newsletter_sender_rules`, `rss_feeds` | G, R | Move into `sources`. Admin-managed catalog. Custom per-user feeds are v2. |
| `entities` | P, R | Unique (user_id, name). Every upsert site keyed on name changes (`phase6/entities.ts`, `system-block.ts`, `context-builder/output/db-writer.ts`, `context/corrections.ts`, lower-cased lookup). `search_tsv` stays. |
| `entity_mentions` | P | Unique (entity_id, source_kind, source_ref) is fine once entity is per user, add user_id for RLS. |
| `entity_appearances` | P | Unique (entity_id, report_date) fine, add user_id. |
| `source_quality`, `source_daily_scores` | R | Global facts to `sources`. Per-reader trust, activity and daily scores to `user_sources` plus `source_daily_scores (user_id, source_name, run_date)`. The weekly scoring job becomes per user. |
| `contacts` | P | Unique (user_id, identifier). Four writers key on identifier alone (`teach-contact.ts`, `context/corrections.ts`, `phase6/contacts.ts`, `db-writer.ts`). |
| `context_builder_runs` | P | user_id. Latest completed run per user is that user's document. |
| `context_builder_indexed_items` | P, R | Unique (user_id, source, item_id). Message-ids collide across users. |
| `context_corrections` | P | user_id. |
| `notes`, `note_revisions` | P | user_id. Declare the missing unique index on (user_id, source_key) where set (documented but not in the schema, so check prod first). |
| `questions`, `question_events` | P | user_id. |
| `chat_conversations`, `chat_messages` | P | user_id. |
| `raw_items` | S, R | user_id nullable. Replace global `message_id` unique with two partial uniques: (message_id) where user_id is null, and (user_id, message_id) where not null. Fix `onConflictDoNothing({target: messageId})` in `ingest/imap.ts`, `ingest/rss.ts`, `news/store.ts`, `ingest/google.ts`, `ingest/sms.ts`. `account_id` becomes a real FK. |
| `extractions` | S, R | user_id nullable (private items carry the owner). Per-reader columns move to `item_verdicts`. `search_tsv` stays. |
| `ingest_drops` | S | user_id nullable. |
| `active_topics` | P | user_id. |
| `daily_reports` | P, R | user_id, unique (user_id, report_date). Upsert at `phase6-memory.ts:60-81` changes target. `search_tsv` stays. |
| `report_audio` | P, R | PK adds user_id. Prefer moving the blobs to object storage or disk with 7 to 14 day retention. |
| `brave_daily_usage` | G, R | Becomes `provider_usage`. Platform cap stays; per-user counters added. |
| `report_actions` | P | user_id. |
| `feedback_events` | P | user_id. |
| `push_subscriptions` | P | user_id, bound to a session or device. Endpoint stays unique. |
| `pipeline_runs` | S | user_id nullable (platform runs). Unique running (user_id, run_date) is the lock. |
| `pipeline_run_steps` | P | Denormalize user_id for RLS. |
| `notification_reads` | P, R | PK (user_id, notification_key). |
| `jev_decisions` | P | Adapter is unused today. Add user_id before it is ever used. |

Also:

- [ ] `src/db/search-columns.sql` (tsvector columns and GIN indexes on reports, extractions, notes, entities) is hand-applied and not in the Drizzle schema. Fold it into the migration system, and add user-scoped composite indexes. `dashboard/src/lib/server/search.ts` must filter by user.
- [ ] Missing cascades matter for deletion: `extractions.raw_item_id`, `feedback_events.extraction_id`, `context_builder_indexed_items.run_id`, plus the id arrays with no FK (`active_topics.entity_ids`, `report_actions.source_extraction_ids`, `questions.sources`). Account deletion (section 9) must be a tested, ordered, whole-user delete.
- [ ] Every per-user table gets an RLS policy `user_id = current_setting('app.user_id')::uuid`. Shared-capable tables add read access for `user_id IS NULL`.

## 5. Phased work

Each phase ends with a gate. Do not start the next phase before the gate passes. After each phase, anything still open moves into `docs/todo/` in full, and this file shrinks.

### Phase 0: Decisions, measurement, long-lead items (no code)

- [ ] Answer the decisions in section 12.
- [ ] Measure cost per run (section 3). Pick a price hypothesis and a target margin.
- [ ] Legal groundwork in section 9: engage counsel, name the controller entity, start the subprocessor list. Review publisher terms for the shared newsletter layer (section 9.5).
- [ ] Start Google OAuth verification early. Calendar and Tasks scopes are sensitive, the review takes weeks, and until verified the app is limited to 100 test users with a warning screen. That is enough for a closed beta and not for launch. Prepare the Limited Use disclosure (section 9.3).
- [ ] Create the Stripe account (test mode first), the transactional email provider (with SPF and DKIM for the sending domain), and error tracking with PII scrubbing.
- [ ] Decide hosting for a paid service (section 8.3).
- [ ] Spike: RLS with the Bun SQL driver and with the dashboard's `postgres` pool. Verify per-transaction `set_config('app.user_id', ..., true)` works under pooling, and decide how long-running pipeline runs hold the setting (reserved connection per run versus per-statement transactions).

Gate: written decisions, a cost-per-run number, a Brave and OpenAI capacity answer, a working RLS spike.

### Phase 1: Foundations, with the owner as user #1 (production still single-user)

Goal: the schema and code are multi-tenant, nothing visible changes, the owner's briefing is byte-for-byte the same.

- [ ] Migration tooling: either fix `drizzle-kit migrate` or build a small runner (checked-in SQL files, a `schema_migrations` table, run in a transaction, applied before deploy by `scripts/deploy.ts`). Retire the throwaway-script process in `docs/operations.md`.
- [ ] DB roles: a non-superuser `pidra_app` role for dashboard and workers, with no BYPASSRLS. A separate admin role only for migrations. Move pidra to its own database with its own roles, away from other services on the cluster, and replace `trust` in `pg_hba` with scram auth.
- [ ] Expand migration, additive only: create `users`, add nullable `user_id` to every P and S table, add new tables (section 4.1), create the owner user, backfill every existing row to the owner (section 7).
- [ ] Thread identity through the code as an explicit argument. `runPipeline(userId, date)`, `executeSkill` context (`SkillContext.userId` required), every store module, `loadEmailAccounts(userId)`, `loadSettings(userId)`, `googleAuth(userId)`. No ambient global user, no process-level memo without a user key. The process-level caches to re-key: email accounts, newsletter config, `calendarTimeZone()`, `taskListIds` (module scope in `ingest/google.ts`), the long-term context.
- [ ] A scoped data-access layer on both stacks. Drizzle: helpers that take `userId` and apply the filter. Dashboard: replace direct `sql()` use with `withUser(userId, fn)` that opens a transaction, sets `app.user_id`, and runs the query.
- [ ] A new repo check, `scripts/check-tenant-scope.ts`, wired into `bun run check` like `check-skill-writes.ts`: fail on any query against a tenant table that does not go through the scoped layer. Add it before the refactor so the refactor is guided by it.
- [ ] Move the owner's env-based config into DB rows (section 7): home location, language, Google token, GitHub token, Keep token, SMS secret.
- [ ] Re-key every constraint and `ON CONFLICT` target (section 4.2). Make `user_id` NOT NULL on private tables. Then enable RLS.
- [ ] Rewrite `tests-db/` fixtures to create users, and update all about 35 test files. The harness builds the schema from `drizzle-kit export`, so new columns appear automatically, but every insert needs a user.
- [ ] Add the tenant-isolation test suite (section 10).

Gate: the owner's pipeline run on a restored production dump produces the same report text and item selection as before the change (diff the `daily_reports` row), `bun run check` is green, and the isolation suite passes with two synthetic users.

### Phase 2: Shared content layer and per-user pipeline

- [ ] Platform ingest job: poll the platform news inbox (`email_accounts.user_id IS NULL`) and RSS once per run, write `raw_items` with `user_id NULL`. Extraction (newsletter claims and entities) once per shared item, `extractions.user_id NULL`. This replaces the owner-subscribed mailbox model.
- [ ] Make shared extraction user-independent. Today relevance is scored against a fixed rubric and a hardcoded taxonomy (`src/ai/prompts/extraction.ts` allowed `topic_tags` such as AI, China, BCI, Switzerland; echoed in `section1.ts` and the `active_topics.domain` comment). Replace it with a platform taxonomy and neutral significance, and compute per-user relevance in the gate from the user's interest profile and trust. This is the largest quality risk in the project: personalization moves later in the pipeline, so run the old and new gate side by side on real mornings before switching.
- [ ] Split the gate and the downstream stages onto `item_verdicts`: `gate-items.ts`, `gate.ts`, `phase3-context`, `phase5-synthesis` (including the `slice(0, 30)` handoff outcome), `phase6` report-reference resolution, `/[date]/triage`, feedback and implicit feedback.
- [ ] Per-user pipeline: private ingest (personal mail via the user's accounts, Calendar and Tasks via their OAuth connection), per-user gate, synthesis, quick actions, question reconcile, memory writes. `pipeline_runs` get a user_id, and the run lock is the unique running index plus the job row.
- [ ] News desks: classify desks as shared (world, serendipity, talk by country, home by city and country) or per user (beat, field). Shared desks run once per (country, city) per day and store `user_id NULL` results with the existing idempotent key (`news:<date>:<desk>`) extended by location. Per-user desks keep the user's priorities (`notes` with scope `intel`, oldest first) and interests.
- [ ] Per-user local date (A9). Audit every `utcDay()` call (`src/job.ts:30` and others) and every read keyed on date alone (`audio/store.ts`, `context/lookup.ts`, `weekly-meta-run.ts`, `weekly-review.ts`, `implicit-feedback.ts`, dashboard report routes and `reports.ts`). Platform quotas keep the UTC day.
- [ ] Job queue and scheduler (A8): `jobs` table, a scheduler tick, workers with a concurrency limit, per-provider rate limiters shared across workers through the DB (replace the in-process Brave queue), per-user error isolation, retry and backoff, visible job state. `src/job.ts` becomes a worker entry. The systemd units shrink to bridge, dashboard, scheduler and worker.
- [ ] Weekly and monthly jobs per user: `feedback`, `prune`, `review`, `source-scoring`, `meta-run`, `context-builder`. `prune` and `source-scoring` are global SQL today and must become per-user.
- [ ] `meta-run` and prompts: today it aggregates across the whole instance and writes one `global` note. Make it per user, writing only to that user's notes, and keep prompt changes an admin decision based on non-personal aggregate statistics. Never let one customer's feedback or content shape the global prompts.
- [ ] Usage ledger, per-user Brave counters, per-user spend caps, a global OpenAI budget alarm (section 3). Replace `brave_daily_usage` and its `CHECK (calls BETWEEN 0 AND 30)`.
- [ ] Push: send only to the target user's subscriptions with that user's payload (`src/push.ts` currently broadcasts to every subscription).
- [ ] Audio: per-user keys, a cost ledger entry per TTS call, per-plan limits, storage outside Postgres with retention.
- [ ] Make prompts reader-neutral and language-aware: remove "entire readership is a single person" phrasing (`src/ai/prompts/news-desks.ts`), stop hardcoding English in the desk story rules (use `{{language}}`), review the reader traits in `style.ts`, and make the weekly review and meta-run prompts per user.
- [ ] Context Builder as a queued per-user job: configurable lookback (default well below 3 years), per-user cost cap, progress in the DB (`jobs.progress`, `context_builder_runs`), per-user checkpoint state. Remove the on-disk `.checkpoint.json`, `errors.json` and `output/context-*.{json,md}` (they contain PII and are keyed by date only), and stop `scripts/deploy.ts` from rsyncing `context-builder/output/`. The dashboard's start and stop (a single module-level child process in `lib/server/contextBuilder.ts`) becomes enqueue and cancel.
- [ ] Question queue and cold start: use the existing questions queue as the bootstrap for a user with no harvest (the pipeline already runs with no long-term context, "with less personal context"). The weekly `review` needs a cold-start mode.

Gate: in staging, two synthetic users with different languages, time zones and sources each get an isolated report on schedule, shared items are extracted once (verify call counts), a failure in one user's run does not affect the other, and a quota hit shows up in that user's report.

### Phase 3: Accounts and auth

- [ ] Signup: email, verification link, rate limit, bot protection on the endpoint, no account enumeration in responses, minimum age statement.
- [ ] Login: passkey with a username-aware challenge (today `allowCredentials` is empty and any resident passkey answers), email magic link as fallback and recovery, optional app-lock PIN. Rewrite `register/challenge` (today hard-coded `userName: "pidra"`, `userID: "pidra-owner"`). Remove `AUTH_SETUP_TOKEN` as the bootstrap for customers (keep a break-glass path for the operator).
- [ ] Sessions reference a user, `locals.user` is set in `hooks.server.ts`, with idle timeout, device list, revoke one or all, and revoke on password or email change. Consider the `__Host-` cookie prefix.
- [ ] Move in-memory auth state (challenges, pkv nonces, IP lockouts, per-nonce PIN counters in `ExpiringMap`) to Postgres, so a restart or a second process does not reset limits. Set `ADDRESS_HEADER` and `XFF_DEPTH` correctly behind nginx or the lockout keys on 127.0.0.1 for everyone (unverified, check the unit).
- [ ] CSRF: enforce an Origin check on every state-changing JSON endpoint, not only form posts (`docs/todo/security.md` already lists this as open). Required before the first stranger logs in.
- [ ] Hook allowlist additions: `/signup`, `/pricing`, `/welcome`, `/demo`, `/verify`, `/api/webhooks/stripe` (own signature check), `/api/oauth/*` as needed. Logged-out `/` goes to the landing page, because `/` is a mirrored route for logged-in users.
- [ ] Admin role and `/admin` (A11), including user list, usage and cost per user, suspend and unsuspend, job queue, catalog management, prompt approval, and Brave and OpenAI spend. Any impersonation is read-only, explicit and audited in `admin_audit`.
- [ ] Bridge identity: the bridge stops trusting loopback alone. The dashboard sends a short-lived HMAC-signed token carrying the user id on every bridge call (`bridgeFetch`, `bridgeProxy`, `bridgeAction`), and bridge handlers reject calls without it. Handlers read the user id from the token, never from the body. Fix the notes catch-all proxy (`/api/notes/[...path]`) to an explicit allowlist at the same time.
- [ ] Transactional email: verification, magic link, billing notices, security notices, deletion confirmation. This needs a conscious exception to the "dashboard-only notifications" rule in `docs/architecture-rules.md`: system and security email is allowed, user-facing briefing notifications still are not email. It must be separate from the `send_email` skill.
- [ ] Offline layer per user (section 6.4).
- [ ] Skills per user (section 6.5).
- [ ] Rewrite `tests-db/dashboard-*.test.ts` (they assert singleton behavior such as one PIN and `user_settings.id = 1`).

Gate: two real accounts on staging cannot read, write, search, receive push for, or hear audio of each other's data through any page, API route, bridge route or skill. The isolation suite covers every route listed in section 6.

### Phase 4: Onboarding and connectors

- [ ] Onboarding wizard (new): language, timezone, home city and country, interests and priorities (writes the `notes` rows that feed the beat and field desks, today there is no UI for priorities), catalog source selection, delivery time, push permission, then connectors. Show what the first report will look like with no harvest.
- [ ] Email accounts: keep `/settings/email-accounts`, add a connection test step, health status in the UI, and a reconnect action when ingest fails. Apply an SSRF guard to user-supplied IMAP and SMTP hosts: refuse loopback, link-local, private and cloud-metadata ranges, resolve then connect to the resolved address, and re-check on every connection. A private-host check already exists for feed URLs (see the recent commit closing the trailing-dot hole), so extend and share that implementation.
- [ ] Google OAuth web flow: start and callback routes, `state` and PKCE, encrypted refresh token in `oauth_connections`, scope minimization (Calendar events and Tasks), disconnect and revoke, `needs_reauth` handling. Replaces `scripts/google-oauth.ts` and the env token. Expired tokens will be common, so the report's ingest warning needs a "reconnect" action.
- [ ] GitHub: OAuth app or fine-grained token per user, optional. Remove the `gh auth token` fallback in `context-builder/config.ts` entirely (it would use the credentials of whoever runs the worker).
- [ ] Encryption: replace the single `CONFIG_ENCRYPTION_KEY` with envelope encryption (a per-user data key wrapped by a master key held outside the DB, for example systemd credentials or KMS). Both `src/config/crypto.ts` and `dashboard/src/lib/server/crypto.ts` change. Plan key rotation. Losing the master key today means every stored password is lost.
- [ ] Harvest onboarding: an opt-in first harvest with an estimated cost and time shown up front, a configurable lookback, progress in the UI, and a cancel button. Context Builder output headings (`# 1.` to `# 5.`) remain an interface (`pickSections`), so any new onboarding path that writes a long-term context must produce them or leave it null.
- [ ] Credential filtering beyond Keep: the rule "credentials never reach a cloud API" is enforced only for Keep notes today. For customer mail add a scrubber for password-reset links, one-time codes, card and account numbers, and tokens before text goes to OpenAI, and make sensitive categories opt-in (section 9.4).
- [ ] Feature flags per user (`keep`, `sms`, `send_email`, `harvest_depth`, `tts`), used for the owner's extras and for plan entitlements.

Gate: a new user with a clean browser signs up, verifies, connects one mailbox and Google, picks sources, and receives a first report on schedule without operator involvement.

### Phase 5: Billing

- [ ] Stripe Checkout (hosted), Customer Portal, `/billing` page, `/pricing` page, trial handling, plans with entitlements enforced server-side (not only in the UI).
- [ ] Webhook endpoint: signature verification, idempotency through `stripe_events`, handlers for checkout completed, subscription updated and deleted, invoice paid and failed. The route is public in the hook allowlist and owns its verification.
- [ ] Lifecycle: trial, active, past due (grace period, then pause), canceled (keep data for a defined period, then delete), reactivation. The scheduler skips suspended and unpaid users, and the UI says why.
- [ ] Spend caps tied to plans (section 3) with a user-visible usage view.
- [ ] Tax and invoicing: Stripe Tax or equivalent, VAT handling for the consumer jurisdictions served, invoices in the portal, refund and EU withdrawal-right handling for digital content (section 9).
- [ ] Reconciliation job: compare local `billing_accounts` to Stripe daily to catch missed webhooks.

Gate: end-to-end in Stripe test mode, including failed payment, cancel and reactivate, with the pipeline starting and stopping accordingly.

### Phase 6: Demo, landing and public pages

- [ ] Demo account: a `users` row with `status = demo`, seeded with synthetic data only (reports, extractions, entities, contacts, notes, questions, a chat). Never derive demo content from the owner's data (repo Privacy rule). Generate it with a seed script from fictional fixtures, dated relative to today so the newest report always looks fresh, rebuilt nightly.
- [ ] Guest sessions (`auth_sessions.kind = demo`), created without signup via `/demo`. The data layer rejects every write for a demo session, not only the UI. The assistant, chat, skills, deepen, TTS generation, quick actions and push are disabled or served from canned content so the demo can never trigger a paid model call or a real side effect. Pre-generate demo audio if the Play button is shown.
- [ ] Demo and the offline layer: namespace the IndexedDB and caches for the demo so a demo mirror never mixes with a real account on the same device (section 6.4). Add a clear "Demo" banner and a signup call to action.
- [ ] Abuse controls on `/demo`: rate limit, no unbounded session creation, cheap to serve (the demo should be readable from a snapshot).
- [ ] Landing page, pricing, FAQ, status and contact. Rewrite `/privacy` and `/terms` (today they speak of one "operator" who "configured your access"). They are prerendered, so adapter-node serves them without the hook's security headers. Fix that.
- [ ] Optional later: a "try it with your interests" teaser that needs no account. Not in v1 (it spends money for anonymous visitors).

Gate: a visitor with no account can use the demo on a phone in under a minute, and cannot cause any write, spend or outbound message.

### Phase 7: Hardening and launch

- [ ] Security review of the whole multi-tenant surface (use the repo's security review pass plus an external review if the budget allows). Re-run the full isolation suite against staging.
- [ ] Backups: encrypted, off-site, tested restores, point-in-time recovery, defined retention, and a documented way to remove a deleted user from backups within a stated window. Today it is a weekly `pg_dumpall` to a disk on the same host.
- [ ] Observability and alerting to the operator: job failures and queue depth, per-user and global spend, quota breaches, webhook failures, auth anomalies, disk growth. The operator alert channel may be email (the "dashboard only" rule is about reader notifications).
- [ ] Staging environment: separate database, Stripe test mode, a copy of the deploy path. There is no staging today.
- [ ] Service hardening: a dedicated service user, systemd sandboxing, `LoadCredential` or agenix instead of a plain `.env` in the checkout, enforcing CSP instead of Report-Only (note the three sha256-pinned inline scripts in `hooks.server.ts`), and the open items in `docs/todo/security.md`.
- [ ] Load and capacity test: N synthetic users through the real scheduler against mocked providers, then a small real run. Measure wall-clock per user, DB growth per user per month, memory (the snapshot cache and Context Builder RSS watchdog of 4 GB), and queue latency at 06:00 local.
- [ ] Closed beta: a limited number of invited users on free access, within the Google unverified-app limit, with cost tracked per user. Fix what breaks. Then open paid signup.
- [ ] Runbook: incident response, key rotation, restoring one user, deleting one user, suspending one user, a provider outage (OpenAI, Brave, Google, Stripe), breach notification procedure.

Gate: backup restore tested, load test passed, beta users ran for at least two weeks with no cross-tenant incident and with unit economics matching the Phase 0 model.

## 6. Surface-by-surface changes

### 6.1 Dashboard pages

| Route | Change |
|---|---|
| `/` , `/[date]`, `/[date]/detail/[ids]`, `/[date]/triage` | Scoped to the user. `/` for logged-out visitors goes to the landing page. Triage reads `item_verdicts`. |
| `/notes`, `/contacts`, `/entities`, `/entities/[id]`, `/topics`, `/chat`, `/questions`, `/questions/closed` | Scope every query. `topics` has a direct `UPDATE active_topics` (no bridge). |
| `/context-builder`, `/context-builder/corrections` | Per user. Reads from DB, not disk. Start and stop through the queue. |
| `/sources`, `/sources/[name]` | User view: subscribe, mute, own trust. Catalog editing (hard delete of a source and its scores today) moves to `/admin`. |
| `/settings` | Add timezone, home location, delivery time, account, billing, devices and sessions, data export, account deletion. Interface language stays disabled until translations exist. |
| `/settings/email-accounts` | Per user, add connection test and health. |
| `/settings/newsletters`, `/settings/newsletters/rules` | Admin catalog tooling. Users get source selection in onboarding and `/sources`. |
| `/skills`, `/skills/executions` | User sees and toggles own skills and confirms own pending executions. The global toggle moves to `/admin`. |
| `/runs`, `/runs/[id]` | User sees own runs. Platform runs and cost only in `/admin`. |
| `/login`, `/setup` | Rewritten (Phase 3). `/setup` stops being an operator bootstrap for customers. |
| `/privacy`, `/terms` | Rewritten, with a named controller, contact, processor list and retention. |
| New | `/signup`, `/verify`, `/welcome` (landing), `/pricing`, `/onboarding`, `/billing`, `/account`, `/demo`, `/admin/*`. |

Every new route must also be registered in `lib/routes.ts`, `lib/offline/tiers.ts` or `onlineOnly.ts`, `src/ai/surfaces.ts` and the blackhole `helpers.ts`, or `check-route-surfaces.ts` and `check-offline.ts` fail.

### 6.2 API routes and the bridge

Scope or restrict all of: `nav-badges` (global counts today), `search`, `extractions` and `extractions/[id]/raw` (no ownership check on `raw_items.raw_content`), `feedback`, `notifications/report-read/[date]`, `settings`, `push/subscribe`, `offline/snapshot`, `chat`, `assistant/*`, `notes/[...path]`, `actions/[id]/[op]`, `report-audio/*`, `pipeline/status`, `context-builder/*`, `server-status`. Bridge routes with no auth today: `POST /api/pipeline/run`, `POST /api/deepen`, report audio, notes, questions, actions, chat, assistant, `/skills`, `PATCH /skills/:name`, skill execution decisions, context corrections. All need the signed user token. `POST /api/pipeline/run` becomes "enqueue my run, rate limited". The SMS webhook is out for customers (A12) and per-user secret and owner-only flag for the owner.

### 6.3 Pipeline modules

Every module under `src/pipeline/`, `src/ingest/`, `src/news/`, `src/search/`, `src/context/`, `src/questions/`, `src/notes/`, `src/actions/`, `src/audio/`, `src/settings/`, `src/config/` takes a user id or is explicitly platform-level. The check script (Phase 1) is what proves nothing was missed.

### 6.4 Offline mode

- [ ] Namespace by identity: record the owning user id in the `meta` store and compare it with the session's user on every load, wiping the mirror, outbox and `failed` stores on mismatch. Alternatively key the database name by user id.
- [ ] Wipe on session expiry or revocation detection, not only on explicit logout. Logout is disabled offline, and the mirror is readable with no auth check by design (`sw/cache.ts`), so a shared device keeps the previous user's reports until a wipe.
- [ ] Bind the outbox to a user id so a queued write by one account is never flushed under another's session.
- [ ] Per-user snapshot: `snapshotCache.ts` computes one snapshot per server process and fingerprints whole tables, which would serve one user's data to everyone. Make it per user with a bounded cache, per-user ETags and scoped assembly queries (`lib/server/offline/snapshot.ts`, which reads notes raw without a user filter).
- [ ] Prefix localStorage keys (assistant draft, open state) and unsubscribe push on logout. Bump `DB_VERSION` for any store change.
- [ ] Update the blackhole suite (`fixture.ts`, `proxy.ts`, the first-launch step), keep the `PIDRA_BLACKHOLE_TEST` stub working by injecting a user in `locals`, and update `tests/offline-*.test.ts`.

### 6.5 Skills and the assistant

- [ ] `SkillContext` gets a required user id. `skill_executions`, enabled and disabled state are per user. A platform-level policy table decides which skills exist for which plan.
- [ ] Google Calendar and Tasks skills use the user's OAuth connection through a per-user client factory. `calendarTimeZone()` stops being a per-process cache.
- [ ] `send_email` only through the user's own configured account, never the system `IMAP_USER` path or `ALLOWED_EMAIL_RECIPIENTS`. Remains high risk with confirmation. `create_file` is removed for customers (it writes to host filesystem roots).
- [ ] Prompt injection is a documented open risk (`docs/security.md`) and gets more serious with paying users. The `questions` surface runs unattended with broad edit skills over untrusted mail text, and Calendar and Tasks skills run without confirmation. Before launch, either require confirmation for destructive calendar and task writes on unattended surfaces, or take the write skills off that surface for customers. Also keep calendar invitations to guests off by default (the default is already "no attendees").
- [ ] `propose_prompt_version` and `prompt_versions` become admin-only. A user cannot change prompts that affect other users.

## 7. Migrating the owner's existing data

The owner becomes user #1 with the admin role. The process is rehearsed on a restored copy of the production database first, using the existing throwaway-Postgres harness in `scripts/lib/test-postgres.ts`.

1. Freeze and back up. `pg_dump` the database, copy it off the host, and verify it restores. Stop the timers for the maintenance window.
2. Check drift. Compare the live schema with `src/db/schema/` and `search-columns.sql`. In particular, check whether the `notes.source_key` unique index exists in production.
3. Expand (additive only): create `users` and the new tables, add nullable `user_id` columns, create the owner row.
4. Backfill in batches, one table at a time:
   - Private tables: `user_id = owner`.
   - `raw_items` and `extractions`: rows with `source_type` of newsletter, RSS or web news (shared desks) get `user_id NULL`. Rows with `personal_email`, `sms`, `calendar`, `todo` get the owner. Web-news desks that used the owner's home location stay shared only if keyed by location, otherwise they stay owner rows (decide per desk).
   - `extractions` per-reader columns copy into `item_verdicts` for the owner.
   - `source_quality`: global facts into `sources`, per-reader columns into `user_sources` for the owner. `source_daily_scores` to the owner.
   - `email_accounts`: the news account(s) become platform accounts (`user_id NULL`), personal accounts belong to the owner. Re-encrypt passwords under the new envelope scheme.
   - `rss_feeds`, `newsletter_sender_rules` into `sources`.
   - `user_settings` row 1 to the owner's row, with timezone and home location filled in from the env values.
   - `auth_credentials`, `auth_pin`, `auth_sessions` to the owner (or force a fresh login).
5. Move env credentials into the DB: Google refresh token into `oauth_connections`, GitHub token, Keep master token (owner flag only), SMS secret as a per-user token, `NEWS_HOME_*` and language into settings. Keep the env fallbacks for one release for rollback, then remove them (including `PIPELINE_CONTEXT_SECTIONS_*` knobs that should become per-user settings if they matter).
6. Re-key constraints (section 4.2), update `ON CONFLICT` targets in code, set `user_id` NOT NULL on private tables, enable RLS.
7. Verify with scripted checks: row counts per table before and after, zero NULL `user_id` on private tables, every `item_verdicts` row maps to an extraction, the owner's last 30 reports render identically in the dashboard, and a dry-run pipeline on the copy matches a pre-migration dry-run (item selection and report text).
8. Contexts on disk: import `context-builder/output/*.json` into the DB if anything in them is not already in `context_builder_runs.document`, then delete the files and stop the deploy rsync.
9. Cut over: deploy the new code, start the scheduler, watch the first morning run. Keep the pre-migration dump for the agreed retention window.
10. Contract (later release): drop the old columns and constraints, remove env fallbacks, delete `brave_daily_usage`, drop the per-reader columns from `extractions`.

Rollback: until step 6, the old code works against the expanded schema (additive changes only). After step 6, rollback is restore from the step 1 dump, so do 6 and 9 in one window, and only after the rehearsal passed twice.

Preserve through the migration: `notes.source_key` tombstones, `entities.locked` and `previous_state` snapshots, `contacts` corrections, and the append-only `context_corrections`. A re-seed by the Context Builder after the migration must not clobber corrections.

## 8. Infrastructure and operations

### 8.1 Database

- Own database and roles, scram auth, TLS, no LAN-wide `trust`, no superuser app connection. Today the cluster also hosts other services and trusts `192.168.10.0/24` entirely.
- Connection pooling sized for N workers plus the dashboard pool (5 today). RLS needs per-transaction settings, so pgbouncer must run in transaction mode if added.
- Capacity: per-user growth (raw mail bodies in `raw_items.raw_content`, extractions, chat, audio). Add retention rules for raw content, audio and old run steps. Plan indexes after measuring.

### 8.2 Secrets

Move from a plain `.env` in the checkout (loaded as `EnvironmentFile`, not carried by deploy) to `LoadCredential` or agenix. The master encryption key lives outside the database and outside the repo directory. The repo is public, so provisioning, seeds and docs must never contain real values, and `.env.example` stays placeholder-only.

### 8.3 Hosting

The current host is a private server on a home or office LAN (`192.168.10.85`) with one box, no staging and no off-site backup. For paying customers decide: stay (with a static address, UPS, off-site backup, and a clear risk statement), or move to a hosted server. NixOS makes the move mostly a config change. Unit and nginx definitions live in `/etc/nixos`, outside this repo, so moving scheduler and worker units, rate limits and `ADDRESS_HEADER` is a NixOS rebuild, not a deploy. Keep tenant provisioning out of NixOS entirely.

### 8.4 Deploy

`scripts/deploy.ts` (pull, install, build, restart bridge and dashboard, curl `/` and `/context-builder`) gains: run pending migrations before restarting, restart scheduler and workers, smoke test signup page and a health route, and a staging target. Remove the rsync of `context-builder/output/`.

## 9. Legal, privacy and compliance

This section is an engineering checklist, not legal advice. Have a lawyer review it before launch.

### 9.1 Roles and documents

- [ ] Name the controller (a legal entity, address, contact). The current pages describe an anonymous "operator".
- [ ] Data processing agreements and a subprocessor list: OpenAI, Brave, hosting provider, Stripe, transactional email provider, error tracking, backup storage, web push services (Apple, Google, Mozilla).
- [ ] Records of processing, a DPIA (the product reads private mail, calendar and tasks of identifiable people), and a breach notification procedure (there is no `auth_events` or detection today, Phase 3 adds it).
- [ ] Rewrite `/privacy` and `/terms`; add an imprint if the entity's jurisdiction requires one; consumer terms covering refunds and the EU withdrawal right for digital content; an acceptable use policy.
- [ ] Cookies: only essential cookies exist (session, UI flag, short-lived login cookies), which normally needs no consent banner. Re-check when adding analytics or Stripe.

### 9.2 Data subject rights

- [ ] Export: a per-user export of all data (JSON plus readable reports).
- [ ] Erasure: a whole-user delete that removes every row, including the arrays and JSON with no foreign keys, and audio. "Reports are final" and "harvested context is never edited" are per-row rules and need an explicit documented exception for account deletion (architecture-rules update), because deletion is not a skill.
- [ ] Backups: define how long deleted data stays in backups and say so in the policy. The current policy says removing a source does not erase derived records, backups or provider copies, which is not acceptable as a customer promise.
- [ ] Third-party data: mail contains other people's data. State the lawful basis and how those people can object.

### 9.3 Google

Calendar and Tasks scopes are sensitive and require OAuth app verification. Google's API Services User Data Policy has Limited Use requirements. Sending Google user data to a third-party model provider must be disclosed and must fit those limits, and use of the data for general AI training is not allowed. The existing privacy page already claims Limited Use compliance, so verify that claim against what the pipeline really does (Calendar and Tasks text goes to OpenAI for extraction, synthesis and quick actions). Scope to the minimum, publish the disclosure, and get the verification before leaving the 100-test-user limit.

### 9.4 Sensitive data and processors

- [ ] OpenAI: `store: false` and `service_tier: "flex"` do not mean zero retention (abuse monitoring retention applies unless a zero-data-retention agreement exists). The policy must not claim otherwise, and the question of zero-data-retention terms should be settled before taking customer mail.
- [ ] The speech endpoint is the documented exception (`speak()` cannot pass `store: false` or `service_tier`), so spoken report text reaches OpenAI without them. Disclose it, and make audio opt-in.
- [ ] The owner decided diary and other intimate content is in scope for his own data. That decision does not transfer. Special-category data (health, beliefs, and similar) needs explicit, separable consent, a per-user switch, and likely exclusion by default. The mail scrubber (Phase 4) is part of this.
- [ ] Brave receives search queries derived from the home location, interests and intel notes only, never the personal sections (`docs/architecture-rules.md`). Keep that guarantee and state it.
- [ ] Push payloads can show up to 120 characters of model-generated summary on a lock screen. Make the content level a user setting, defaulting to generic.

### 9.5 Publisher content

The shared layer receives paid and free newsletters through platform subscriptions and summarizes them for paying customers. Check each publisher's terms for commercial summarization and redistribution before launch, drop or negotiate sources that forbid it, and prefer sources that are public RSS or explicitly permit it. Check Brave's API terms for serving search results to customers as well. This could change the product (for example, link and short-claim output only), so it belongs in Phase 0.

## 10. Testing strategy

- [ ] Tenant-isolation suite in `tests-db/`: two users with overlapping identifiers (same sender address, same entity name, same `message_id`, same date) and a test for every route, page action, bridge route, skill, search call, snapshot, push send and audio fetch asserting user B sees and changes nothing of user A. Add a negative case per endpoint for an unauthenticated and a demo session.
- [ ] A schema test that lists every table with a `user_id` column, asserts RLS is enabled and has a policy, and fails for any new table that is neither tenant-scoped nor on an explicit global allowlist.
- [ ] `check-tenant-scope.ts` in `bun run check` (Phase 1).
- [ ] Rewrite singleton-asserting tests: `dashboard-auth`, `dashboard-gate`, `dashboard-login-routes`, `dashboard-endpoints`, `dashboard-page-actions`, `dashboard-settings-writers`, `dashboard-snapshot`, `dashboard-bridge-proxy`, and the pipeline tests that insert rows without a user.
- [ ] Stripe webhook tests with signed fixtures, replay and out-of-order events.
- [ ] Job queue tests: lock, retry, per-user isolation, quota exhaustion, suspended user skipped, scheduler catch-up after downtime (the systemd `Persistent` behavior it replaces).
- [ ] Migration rehearsal test: run the owner migration against a restored dump in CI-like conditions, and assert the checks in section 7.
- [ ] Offline: user switch on one browser profile wipes the mirror and outbox, expired session wipes, demo and real mirrors never mix. Extend the blackhole suite accordingly. Remember the blackhole step dominates `bun run check` time and flakes under machine load, so use `bun run check:quick` while iterating.
- [ ] End-to-end signup to first report with mocked OpenAI and Brave, using the existing dry-run scripts as the model (`scripts/news-dry-run.ts`, `actions-dry-run.ts`, `questions-dry-run.ts`).
- [ ] Load test (Phase 7).
- [ ] Keep every new file under the size limits enforced by `check-file-size.ts` (350 lines for `.ts`, 250 for `.svelte`), and keep `check-openai-rules.ts` green: every model call still goes through `src/ai/openai.ts` with `store: false` and `service_tier: "flex"`.

## 11. Documentation to update (handled at commit time)

Do not hand-edit these while implementing. Pass the reasoning to the commit skill and let `docs-committer` write them: `CLAUDE.md` ("What this project is" and Stack describe a single owner), `docs/architecture-rules.md` (exceptions for transactional email, account deletion and per-row immutability, contacts scope per user, credential filtering for mail), `docs/schema-notes.md`, `docs/operations.md` (migration process, jobs, deploy, backups), `docs/security.md`, `docs/dashboard.md`, `docs/offline-mode.md`, `docs/skills.md`, `docs/context-builder.md`, `docs/scoring-formulas.md` (per-user scoring), `docs/newsletter-sources.md` (platform catalog), `docs/todo/*`, and the privacy and terms pages. When this plan is complete, delete this file and move anything open into `docs/todo/`, self-contained.

## 12. Decisions needed from the owner

Blocking Phase 0 answers, in order of impact:

1. Target scale for launch and for 12 months (10, 100, 1000 users). It sets the isolation model, hosting, Brave plan and the amount of queueing work.
2. Hosting for a paid service (keep the home or office server, or move).
3. Pricing and unit economics. Needs the cost-per-run measurement first.
4. Legal entity, jurisdiction and target markets (EU, Switzerland, others). It decides VAT, imprint, consumer-rights handling, and the controller.
5. The shared newsletter model is acceptable commercially (section 9.5), and which of the 32 sources survive.
6. Auth: email plus passkey as proposed, and whether the PIN stays.
7. Which connectors customers get: IMAP, Google Calendar and Tasks, GitHub. Keep and SMS owner-only is the recommendation.
8. Whether customers get the unattended `questions` surface and write skills, and what confirmation they need.
9. Whether sensitive categories (health, beliefs, diary-like content) are excluded from model input for customers by default.
10. Closed beta first, and the size of the beta.
11. Whether the UI needs translation before launch (`user_settings.ui_language` does nothing yet), or content language only is enough.

## 13. Risks

- Quality: moving relevance out of shared extraction and into a per-user gate may lower briefing quality. Mitigate with side-by-side runs (Phase 2).
- Cross-tenant leak through any missed query, cache or file. Mitigate with RLS, the check script, the isolation suite and removing process-level state.
- Cost runaway from one user (harvest, chat, TTS). Mitigate with caps in the ledger and a global alarm.
- Provider terms (Brave, newsletter publishers, OpenAI, Google) change the product. Mitigate by resolving them in Phase 0.
- Google verification lead time. Start in Phase 0.
- One person operating a paid service on one box: incident response, uptime and support load are real costs. Plan for them in Phase 7.
- Migration touching the only copy of the owner's years of context. Mitigate with a tested restore and a rehearsal done twice.

## Not verified

- Nginx and systemd unit files are in `/etc/nixos/hosts/pronix/`, outside this repo. Statements about timers, rate limits, `ADDRESS_HEADER`, `pg_hba` and how the SMS webhook is reached from the internet come from docs and the survey, not from reading the units.
- Table and file counts come from a grep of the schema (40 tables). Per-route details come from reading the route files. Some pages' `.svelte` files were not opened.
- Whether the `notes.source_key` unique index and the `search-columns.sql` columns exist in production.
- Real cost per run, real Brave plan limits and the OpenAI account's rate limits. They are inputs to Phase 0, not assumptions.
- Whether `drizzle-kit migrate` still hangs. The docs say it does.

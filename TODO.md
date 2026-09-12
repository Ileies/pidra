# PIDRA - TODO

Open work only. Phases 0-6 and the Context Builder are complete; the roadmap is `MORNING_BRIEFING_PLAN.md`, the reasoning behind settled decisions is `CONTEXT_AND_DECISIONS.md`, and what was already built is in git history rather than here. Closed entries are removed on sight - if a fix needs to be remembered, it belongs in a code comment or in one of those documents.

Corrections about the owner (relationships, client domains, standing rules, commitments, trip dates) are not tracked here: they are made in `/chat`, where `context_corrections` records them with provenance.

## Now

- **[SECURITY]** One superseded Google refresh token is still valid and was exposed in an agent transcript on 2026-09-12. **Owner's decision that day: leave it live for now.** It carries `calendar.events` and `tasks`, so it can read and write the calendar and task lists but reaches no mail. Killing it means revoking the grant at `myaccount.google.com/permissions`, which takes every refresh token for the client with it - so it must be followed immediately by `bun scripts/google-oauth.ts` and a re-sync of pronix's `.env`. Revoking *after* a mint kills the token just minted, which is why the helper no longer suggests it
- **[INFRA]** Check whether the Google OAuth consent screen is still in **Testing**. If it is, refresh tokens expire every 7 days and the 2026-09-12 outage repeats on a timer. Publishing to Production is the fix
- **[INFRA]** Test the daily pipeline against real newsletters for 3 days and tune the extraction prompts. The counter restarts from 2026-09-12, the first run that completed with every source healthy; before that only one usable report existed, so the prompts have never been judged on more than a single day
- **[BUG]** IMAP accounts fail intermittently and not always the same one: `imap:ileies@d.5` on one run, `imap:elias@klassen.ch` on the next, both in the auth-timeout path. DNS resolves and 993 is open from pronix for `d5.skyfax.ch`, so it is credentials or a hanging auth rather than the network. Visible since phase 1 started reporting per-source failures instead of only logging them; the 2026-09-12 runs were clean, so it is transient rather than constant
- **[BUG]** `pidra-dashboard` ignores `SIGTERM` and is `SIGKILL`ed after systemd's default 90 s stop timeout, so every redeploy stalls a minute and a half and tears down in-flight requests. The trigger is an open connection: adapter-node waits on the assistant's SSE stream, which by design never ends. Fix belongs in `hosts/pronix/pidra.nix` - a short `TimeoutStopSec` plus a `SIGTERM` handler that closes the SSE subscribers rather than waiting them out
- **[INFRA]** The monthly harvest on pronix sees no GitHub repos: `resolveGithubToken` wants `GITHUB_TOKEN` in `.env` and otherwise falls back to `gh auth token`, and the server has neither. Not a failure - the source is skipped, and the patch delta omits a source it did not fetch rather than handing over "No GitHub data", so section 5 carries forward intact (verified 2026-09-12: it grew 6001 → 6492 chars on a run with zero repos). But it is frozen at the 2026-09-10 state and will drift. Needs a read-only fine-grained PAT in `/var/www/pidra/.env`; the workstation's `gh` credential is interactive and does not belong on the server
- **[FEATURE]** `batchContacts` computes `categories` and `actionCount` per contact and discards them. **Decided 2026-09-12: add both columns.** A migration plus the same insert-only seeding `contacts.email_count` already gets, so the live pipeline owns them afterwards - the `entities.mention_count` split. `/contacts` is where they surface. No reader today and that is accepted: the computation already exists, so persisting it costs a migration and nothing else, while recomputing it later would mean another full-corpus Context Builder run
- **[FEATURE]** Stop storing a filesystem path in `context_builder_runs.output_path` - a cross-machine assumption the schema never held. Largely defused on 2026-09-12: the monthly run executes on pronix now, so every future harvest lands where the pipeline reads it, and a stored path that does not resolve falls back to this machine's output directory by basename. What is left is the historical rows and the principle; storing the document content in the row is still the real fix. **Not urgent**
- **[FEATURE]** Soft-deleted notes are never purged. Deliberate for now - the trash view makes them visible and the volume is tiny. If it ever matters, the Sunday 02:00 pruning job is the place to age them out

## Soon

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
- **[DECISION]** Evaluate web search quality - upgrade from Brave to Tavily or Exa if insufficient. Cost is not the constraint (3 slots/day is ~90 calls against a 2,000/month free tier), so the trigger is consistently thin slot 1 deep-dives, not quota

## Later

**Phase 8 - Smart reply** (only after all prior phases are complete and stable):
- **[FEATURE]** `reply_monitoring: boolean` per address config block
- **[FEATURE]** A dedicated pass during personal email classification deciding whether a mail deserves a reply; flag on `raw_items`/`extractions`
- **[FEATURE]** "Mails worth replying to" panel in the dashboard (collapsible, sender + subject + one-line summary)
- **[FEATURE]** Reply option A - "later reply" template with a delay dropdown (2h/4h/8h/24h/2d/3d/1w), AI-generated polite placeholder, previewed before sending via SMTP
- **[FEATURE]** Reply option B - AI-drafted full reply with all context (contact history, active topics, entity graph), editable, regenerable, sent via SMTP
- **[INFRA]** `sent_replies` table (message_id, raw_item_id, reply_type, sent_at, body_hash) for audit and dedup
- **[FEATURE]** GitHub activity integration (PR reviews, CI failures) by **polling, not webhooks** (decided 2026-09-10): a webhook means public ingress, and the skills bridge staying LAN-only is worth more than the latency saved

**Skills - critical tier** (decided 2026-09-10: critical-risk skills *will* exist, contrary to the earlier blanket "never"). Until both designs below are written and built, `critical` stays "always rejected" in `executeSkill()`:
- **[DECISION]** The approval model, before any critical skill is written. Every execution needs an explicit yes from the owner, per call, not a standing grant
- **[DECISION]** The execution model: skill use should run as a real sequential agentic loop (act, observe, decide the next step), not one shot firing a batch of calls. Touches `src/ai/chat.ts` and `executeSkill()`, so it needs its own written plan

**Semantic search over the archive** (pgvector + local embeddings, hybrid ranking; design in `DASHBOARD_PLAN.md` §12):
- **[FEATURE]** A vector store is planned (decided 2026-09-10) but for the far future and as its own project - explicitly not part of any current phase. Preconditions: the archive past ~60 reports, and the `tsvector` keyword search that shipped in D8 demonstrably failing

**Email self-hosting** (decided 2026-09-10: not now):
- **[INFRA]** Revisit after ~60 days of stable runs. It puts deliverability and IMAP reliability under the one system that is meant to be trustworthy. When it happens: **Stalwart** - a single binary, far less config surface than Postfix + Dovecot, and a better fit for a NixOS module

---

## Operational notes

- `DATABASE_URL` points at `192.168.10.85`, reachable on the LAN only. To run from outside, tunnel first: `ssh -N -L 15432:127.0.0.1:5432 ros`, then point `DATABASE_URL` at `127.0.0.1:15432`

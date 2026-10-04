# Later

See `docs/todo/README.md` for the conventions this list follows.

- **[FEATURE]** Travel-aware home desk: when the calendar puts the reader in another city (a trip, the China pre-trip window in `docs/prompt-tuning-context.md`), cover that city as well as home for the duration. The home desk reads one fixed `NEWS_HOME_*` location today (`src/news/config.ts`)
- **[INFRA]** Bounded, read-only offline snapshots for `/runs` and `/sources`, with a prominent as-of time and an offline label. Keep only recent run history and source trust/active summaries with the latest daily-score date; stale data must never look live. Both routes are online-only today. `/questions`, `/skills` and `/chat` stay online-only because stale question or approval state can cause harmful actions
- **[FEATURE]** Close the entity-graph loop: when an item question about a sender is answered, feed the answer into entity resolution as well as `contacts`, so answering "who is X" also enriches the entity that sender is tied to. Scope it only after the week of questions-queue use in `docs/todo/user.md`, since it touches the entity graph directly
- **[FEATURE]** Translate the dashboard UI with Paraglide (`@inlang/paraglide-js`, not installed yet in `dashboard/`). Move every hard-coded UI string into message files and make the interface follow `user_settings.ui_language`, which is stored but changes nothing, and the interface-language select on `/settings` stays disabled until this ships. English only to start, and `UI_LANGUAGES` in `src/config/languages.ts` stays short on purpose, since each language is hand-maintained. Also cover strings outside components: nav labels in `dashboard/src/lib/routes.ts`, `labels.ts`, the report's urgency and section titles (display only, the parser keeps those headings in English), the assistant hints in `src/ai/surfaces.ts`, and the questions code writes itself (`entity-questions.ts`, `stale-context-questions.ts`, `contact-suggestions.ts`, `mechanicalPlan` in `src/questions/reconcile.ts`), which reach the reader in English whatever the content language
- **[INFRA]** After Paraglide: a script in `bun run check` that compares the message files and fails on any key missing from a language, listing the missing keys per language

## Phase 8: smart reply

Only after all prior phases are stable.

- **[FEATURE]** `reply_monitoring: boolean` per address config block
- **[FEATURE]** A pass in personal email classification deciding whether a mail deserves a reply, flagged on `raw_items`/`extractions`, and a collapsible "Mails worth replying to" dashboard panel (sender, subject, one-line summary)
- **[FEATURE]** Reply option A: a "later reply" template with a delay dropdown (2h/4h/8h/24h/2d/3d/1w) and an AI-generated polite placeholder, previewed before sending via SMTP
- **[FEATURE]** Reply option B: an AI-drafted full reply using contact history, active topics and the entity graph, editable and regenerable, sent via SMTP
- **[INFRA]** `sent_replies` table (message id, raw item id, reply type, sent time, body hash) for audit and dedup
- **[FEATURE]** GitHub activity (PR reviews, CI failures) by **polling, not webhooks**: a webhook means public ingress, and keeping the skills bridge loopback-only is worth more than the latency saved

## Critical-tier skills

Until both designs below are written and built, `critical` stays "always rejected" in `executeSkill()`.

- **[FEATURE]** Approval flow: explicit owner approval for each consequential action, tied to a preview of the exact operation and inputs. If the inputs change, approve again; never a standing grant
- **[FEATURE]** Execution as a bounded sequential loop: act, observe, then decide the next step, with step limits and stopping conditions, and stopping to resolve an uncertain result instead of blindly retrying. Touches `src/ai/chat/` and `executeSkill()` and needs its own design

## Semantic search over the archive

Start when keyword search has recurring, meaningful misses and the archive is large enough to evaluate retrieval quality. About 60 reports is a review point, not a gate; report count alone does not justify building it. Record representative failures first (for example "that thing about export controls a few weeks ago" when the report said "chip restrictions"); if there are none by then, wait.

- **[FEATURE]** Shape: pgvector inside the existing Postgres, so no second service or source of truth. Embed report *entries*, not whole reports: `report_json` already splits a report into entries with `refIds`, the natural chunk and the link back to the extractions. Hybrid ranking with keyword and vector merged (reciprocal rank fusion is enough), never a replacement: exact-match queries stay exact, and keyword-only is the fallback for any row without an embedding. Backfill existing entries with a one-shot script. All behind the existing `search()` signature, so the UI never learns which backend ranked a result
- **[INFRA]** Evaluate a pinned local embedding model on the server that holds the archive, using representative queries and reliability checks. Archive content stays on that machine. If local quality or reliability falls short, stop and make a separate explicit privacy decision before any cloud embedding service; `store: false` does not replace that decision
- **[FEATURE]** Beyond search: "related reports" on `/entities/[id]` and `/topics`, near-duplicate detection for novelty scoring (keyword overlap today), and an "ask my archive" view once the archive is a year deep. Rough estimate: a day for pgvector, embeddings and backfill, half a day for hybrid ranking

# Later

See `docs/todo/README.md` for the conventions this list follows.

- **[FEATURE]** Travel-aware home desk: when the calendar puts the reader in another city (a trip, the China pre-trip window of `docs/prompt-tuning-context.md`), cover that city as well as home for the duration. The home desk reads one fixed `NEWS_HOME_*` location today
- **[DECISION]** Whether `/runs` and `/sources` get a read-only "last seen" copy offline, labelled with its age, instead of the `OfflineNotice` they show today. Defensible because neither page acts on what it shows; the cost is two more stores in the snapshot and the fingerprint. `/questions`, `/skills`, `/prompts` and `/chat` stay online-only either way: acting on a stale gate or approval is exactly the harm a copy of live state would do. Left open when offline mode shipped (2026-09-25)

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
- **[DECISION]** The execution model: skill use should run as a real sequential agentic loop (act, observe, decide the next step), not one shot firing a batch of calls. Touches `src/ai/chat/` and `executeSkill()`, so it needs its own written plan

**Semantic search over the archive** (planned as its own project, decided 2026-09-10; the design moved here on 2026-09-12 when the dashboard plan was deleted):

- **[DECISION]** Two preconditions, both required: the archive past roughly 60 reports, and the `tsvector` keyword search in `dashboard/src/lib/server/search.ts` demonstrably failing. Below ~60 reports keyword wins on precision and there is nothing for embeddings to generalise over. Why it is wanted anyway: keyword finds the report that used a word, but not "that thing about export controls a few weeks ago" when the report said "chip restrictions", and it cannot answer "what have I read about this entity's suppliers" at all. Continuity across days and compounding value from the archive are exactly the queries `tsvector` is worst at, and the archive grows ~1,000 words a day, so the gap widens on its own
- **[FEATURE]** The shape it should take: pgvector inside the existing Postgres, so no second service and no second source of truth. Embed report *entries*, not whole reports - `report_json` already splits a report into entries with `refIds`, which is both the natural chunk and the link back to the extractions behind it. Hybrid ranking, keyword and vector merged (reciprocal rank fusion is enough), never a replacement: exact-match queries must stay exact, and keyword-only stays the fallback for any row without an embedding. Backfill offline as a one-shot script, same pattern as the `report_json` backfill. All of it behind the existing `search()` signature, so the UI never learns which backend ranked a result
- **[DECISION]** Where embeddings are computed is a privacy decision to make explicitly rather than by default. The archive contains personal content, so a cloud embedding call would require an explicit decision even with `store: false`; a local embedding path would need its own reliability evaluation.
- **[FEATURE]** What it unlocks beyond search: "related reports" on `/entities/[id]` and `/topics`, near-duplicate detection for novelty scoring (keyword overlap today), and retrieval for an "ask my archive" view once the archive is a year deep. Estimate: one day for pgvector plus the embedding path plus the backfill, half a day for hybrid ranking

**Email self-hosting** (decided 2026-09-10: not now):
- **[INFRA]** Revisit after ~60 days of stable runs. It puts deliverability and IMAP reliability under the one system that is meant to be trustworthy. When it happens: **Stalwart** - a single binary, far less config surface than Postfix + Dovecot, and a better fit for a NixOS module
